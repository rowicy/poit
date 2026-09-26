package cmd

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
)

type artifactRequest struct {
	Content    string `json:"content"`
	Filename   string `json:"filename,omitempty"`
	Slug       string `json:"slug,omitempty"`
	Visibility string `json:"visibility"`
	Persist    bool   `json:"persist"`
}

type artifactResponse struct {
	URL string `json:"url"`
}

func apiURL() string {
	if v := os.Getenv("POIT_API_URL"); v != "" {
		return v
	}
	return defaultAPIURL
}

type artifactMeta struct {
	ID         string `json:"id"`
	Filename   string `json:"filename"`
	Mime       string `json:"mime"`
	Visibility string `json:"visibility"`
	Persist    bool   `json:"persist"`
	CreatedAt  string `json:"createdAt"`
	ExpiresAt  string `json:"expiresAt"`
	Title      string `json:"title"`
}

// doRequest sends an authenticated request and returns the response body,
// erroring on a non-2xx status.
//
// Authentication is handled by Cloudflare Access. If a Service Token is
// configured (POIT_CF_ACCESS_CLIENT_ID/SECRET) it's sent as
// CF-Access-Client-Id/Secret headers. Otherwise we fall back to an
// interactive browser login (see auth.go) and send the resulting JWT as
// Cf-Access-Jwt-Assertion. For /api/v1/* Access verifies the request at the
// edge; /artifact/* is left open at the edge and the Worker checks the JWT.
func doRequest(method, rawURL string, body []byte) ([]byte, error) {
	var reader io.Reader
	if body != nil {
		reader = bytes.NewReader(body)
	}
	httpReq, err := http.NewRequest(method, rawURL, reader)
	if err != nil {
		return nil, err
	}
	if body != nil {
		httpReq.Header.Set("content-type", "application/json")
	}

	clientID := os.Getenv("POIT_CF_ACCESS_CLIENT_ID")
	clientSecret := os.Getenv("POIT_CF_ACCESS_CLIENT_SECRET")
	if clientID != "" && clientSecret != "" {
		httpReq.Header.Set("CF-Access-Client-Id", clientID)
		httpReq.Header.Set("CF-Access-Client-Secret", clientSecret)
	} else {
		jwt, err := ensureAccessJWT()
		if err != nil {
			return nil, err
		}
		httpReq.Header.Set("Cf-Access-Jwt-Assertion", jwt)
	}

	res, err := http.DefaultClient.Do(httpReq)
	if err != nil {
		return nil, err
	}
	defer res.Body.Close()

	respBody, err := io.ReadAll(res.Body)
	if err != nil {
		return nil, err
	}
	if res.StatusCode >= 300 {
		var parsed struct {
			Error string `json:"error"`
		}
		if json.Unmarshal(respBody, &parsed) == nil && parsed.Error != "" {
			return nil, fmt.Errorf("api error (status %d): %s", res.StatusCode, parsed.Error)
		}
		return nil, fmt.Errorf("api error (status %d): %s", res.StatusCode, respBody)
	}
	return respBody, nil
}

// createArtifact posts content to the poit API and returns the shareable URL.
func createArtifact(req artifactRequest) (string, error) {
	body, err := json.Marshal(req)
	if err != nil {
		return "", err
	}
	respBody, err := doRequest(http.MethodPost, apiURL()+"/artifact", body)
	if err != nil {
		return "", err
	}
	var parsed artifactResponse
	if err := json.Unmarshal(respBody, &parsed); err != nil {
		return "", fmt.Errorf("unexpected response: %s", respBody)
	}
	return parsed.URL, nil
}

// listArtifacts returns the artifacts owned by the logged-in user.
func listArtifacts() ([]artifactMeta, error) {
	respBody, err := doRequest(http.MethodGet, apiURL()+"/artifacts", nil)
	if err != nil {
		return nil, err
	}
	var parsed struct {
		Artifacts []artifactMeta `json:"artifacts"`
	}
	if err := json.Unmarshal(respBody, &parsed); err != nil {
		return nil, fmt.Errorf("unexpected response: %s", respBody)
	}
	return parsed.Artifacts, nil
}

// fetchArtifactContent returns an artifact's raw body.
func fetchArtifactContent(id string) ([]byte, error) {
	return doRequest(http.MethodGet, accessAppURL()+"/artifact/raw/"+url.PathEscape(id), nil)
}
