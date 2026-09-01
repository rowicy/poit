package cmd

import (
	"crypto/rand"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"time"

	"golang.org/x/crypto/nacl/box"
)

// accessAppAUD is the audience tag of the "shell" Cloudflare Access
// Application (infra/main.tf, cloudflare_zero_trust_access_application.shell)
// that protects poit.rowicy.com. Like an OAuth client_id, it's a public
// identifier, not a secret - safe to embed. It only changes if that Access
// Application is recreated in Terraform.
const accessAppAUD = "737d6ae0b2faa328fcdeb31759de2f6dfcb3f58fa4bed22b5cd82c7a553f2066"

// transferServiceURL is Cloudflare Access's (undocumented) CLI login
// exchange endpoint, reverse-engineered from cloudflared's token package
// (github.com/cloudflare/cloudflared/token/transfer.go): a browser login
// deposits an end-to-end-encrypted app token there, keyed by our ephemeral
// public key, for us to long-poll and retrieve.
const transferServiceURL = "https://login.cloudflareaccess.org/transfer/"

// accessAppURL returns the origin protected by the "shell" Cloudflare Access
// application.
func accessAppURL() string {
	u, err := url.Parse(apiURL())
	if err != nil || u.Scheme == "" || u.Host == "" {
		return "https://poit.rowicy.com"
	}
	return u.Scheme + "://" + u.Host
}

func accessTokenCachePath() (string, error) {
	home, err := os.UserHomeDir()
	if err != nil {
		return "", err
	}
	return filepath.Join(home, ".poit", "access_token.jwt"), nil
}

// ensureAccessJWT returns a Cloudflare Access JWT for the CLI's user: a
// cached one if still valid, otherwise a fresh one via an interactive
// browser login.
func ensureAccessJWT() (string, error) {
	if jwt, err := cachedAccessJWT(); err == nil {
		return jwt, nil
	}

	jwt, err := loginViaBrowser()
	if err != nil {
		return "", err
	}

	if path, err := accessTokenCachePath(); err == nil {
		if err := os.MkdirAll(filepath.Dir(path), 0700); err == nil {
			_ = os.WriteFile(path, []byte(jwt), 0600)
		}
	}

	return jwt, nil
}

func cachedAccessJWT() (string, error) {
	path, err := accessTokenCachePath()
	if err != nil {
		return "", err
	}
	data, err := os.ReadFile(path)
	if err != nil {
		return "", err
	}
	jwt := strings.TrimSpace(string(data))
	if jwtExpired(jwt) {
		return "", fmt.Errorf("cached access token expired")
	}
	return jwt, nil
}

// jwtExpired reads the exp claim without verifying the signature: this is
// our own token, written to a 0600 file we just created, so a forged local
// copy carries no more risk than any other tampering with the user's own
// home directory - and the Worker verifies the signature server-side on
// every request regardless.
func jwtExpired(token string) bool {
	parts := strings.Split(token, ".")
	if len(parts) != 3 {
		return true
	}
	payload, err := base64.RawURLEncoding.DecodeString(parts[1])
	if err != nil {
		return true
	}
	var claims struct {
		Exp int64 `json:"exp"`
	}
	if err := json.Unmarshal(payload, &claims); err != nil {
		return true
	}
	return time.Now().Unix() >= claims.Exp
}

// loginViaBrowser runs Cloudflare Access's CLI login transfer flow: open a
// login URL in the browser, then long-poll for the encrypted app token the
// completed login deposits.
func loginViaBrowser() (string, error) {
	appURL := accessAppURL()

	pub, priv, err := box.GenerateKey(rand.Reader)
	if err != nil {
		return "", err
	}
	pubKey := base64.URLEncoding.EncodeToString(pub[:])

	loginURL, err := buildLoginURL(appURL, accessAppAUD, pubKey)
	if err != nil {
		return "", err
	}

	fmt.Fprintln(os.Stderr, "not logged in to Cloudflare Access, opening browser to log in...")
	if err := openBrowser(loginURL); err != nil {
		fmt.Fprintf(os.Stderr, "couldn't open a browser automatically. Please open this URL to log in:\n%s\n", loginURL)
	}

	body, remotePubKey, err := pollForToken(pubKey)
	if err != nil {
		return "", err
	}

	plaintext, err := decryptTransferResponse(body, remotePubKey, priv)
	if err != nil {
		return "", err
	}

	var resp struct {
		AppToken string `json:"app_token"`
		OrgToken string `json:"org_token"`
	}
	if err := json.Unmarshal(plaintext, &resp); err != nil {
		return "", fmt.Errorf("unexpected transfer service response: %w", err)
	}
	if resp.AppToken == "" {
		return "", fmt.Errorf("login did not return an app token")
	}
	return resp.AppToken, nil
}

// buildLoginURL mirrors cloudflared's buildRequestURL (useHostOnly=true, as
// used by its "access token" command rather than "access login"): the
// redirect target is the bare app origin, not a specific page.
func buildLoginURL(appURL, aud, pubKey string) (string, error) {
	u, err := url.Parse(appURL)
	if err != nil {
		return "", err
	}

	q := url.Values{}
	q.Set("token", pubKey)
	q.Set("aud", aud)
	u.RawQuery = q.Encode()
	u.Path = ""
	redirectURL := u.String()

	q.Set("redirect_url", redirectURL)
	q.Set("send_org_token", "true")
	q.Set("edge_token_transfer", "true")
	q.Set("close_interstitial", "true")
	u.RawQuery = q.Encode()
	u.Path = "/cdn-cgi/access/cli"
	return u.String(), nil
}

// pollForToken long-polls the transfer service for the token deposited by a
// completed browser login. Each request blocks server-side until the login
// completes or the client timeout hits, so the loop itself needs no sleep.
func pollForToken(pubKey string) ([]byte, string, error) {
	client := &http.Client{Timeout: 60 * time.Second}
	reqURL := transferServiceURL + pubKey

	const attempts = 10
	for i := 0; i < attempts; i++ {
		req, err := http.NewRequest(http.MethodGet, reqURL, nil)
		if err != nil {
			return nil, "", err
		}
		req.Header.Set("User-Agent", "poit-cli")

		resp, err := client.Do(req)
		if err != nil {
			continue // timeout waiting for login to complete; keep polling
		}
		body, err := io.ReadAll(resp.Body)
		resp.Body.Close()
		if err != nil {
			return nil, "", err
		}

		if resp.StatusCode >= 500 {
			return nil, "", fmt.Errorf("transfer service error %d: %s", resp.StatusCode, body)
		}
		if resp.StatusCode != http.StatusOK {
			fmt.Fprintln(os.Stderr, "waiting for login...")
			continue
		}
		return body, resp.Header.Get("service-public-key"), nil
	}
	return nil, "", fmt.Errorf("timed out waiting for browser login")
}

func decryptTransferResponse(body []byte, remotePubKeyB64 string, priv *[32]byte) ([]byte, error) {
	sealed, err := base64.StdEncoding.DecodeString(strings.TrimSpace(string(body)))
	if err != nil {
		return nil, fmt.Errorf("decoding transfer response: %w", err)
	}
	if len(sealed) < 24 {
		return nil, fmt.Errorf("transfer response too short")
	}

	remotePubRaw, err := base64.URLEncoding.DecodeString(remotePubKeyB64)
	if err != nil || len(remotePubRaw) != 32 {
		return nil, fmt.Errorf("invalid service-public-key in transfer response")
	}
	var remotePub [32]byte
	copy(remotePub[:], remotePubRaw)

	var nonce [24]byte
	copy(nonce[:], sealed[:24])

	plaintext, ok := box.Open(nil, sealed[24:], &nonce, &remotePub, priv)
	if !ok {
		return nil, fmt.Errorf("failed to decrypt transfer response")
	}
	return plaintext, nil
}

func openBrowser(rawURL string) error {
	var cmd *exec.Cmd
	switch runtime.GOOS {
	case "darwin":
		cmd = exec.Command("open", rawURL)
	case "windows":
		cmd = exec.Command("rundll32", "url.dll,FileProtocolHandler", rawURL)
	default:
		cmd = exec.Command("xdg-open", rawURL)
	}
	return cmd.Start()
}
