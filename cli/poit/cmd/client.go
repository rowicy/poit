package cmd

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
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
	URL   string `json:"url"`
	Error string `json:"error"`
}

func apiURL() string {
	if v := os.Getenv("POIT_API_URL"); v != "" {
		return v
	}
	return defaultAPIURL
}

// createArtifact posts content to the poit API and returns the shareable URL.
//
// Authentication is handled by Cloudflare Access: a Service Token issued for
// the CLI is sent as CF-Access-Client-Id/Secret headers, which Access
// verifies at the edge before the request ever reaches the Worker - no
// Cloudflare SDK required.
func createArtifact(req artifactRequest) (string, error) {
	body, err := json.Marshal(req)
	if err != nil {
		return "", err
	}

	httpReq, err := http.NewRequest(http.MethodPost, apiURL()+"/artifact", bytes.NewReader(body))
	if err != nil {
		return "", err
	}
	httpReq.Header.Set("content-type", "application/json")

	clientID := os.Getenv("POIT_CF_ACCESS_CLIENT_ID")
	clientSecret := os.Getenv("POIT_CF_ACCESS_CLIENT_SECRET")
	if clientID == "" || clientSecret == "" {
		return "", fmt.Errorf("POIT_CF_ACCESS_CLIENT_ID / POIT_CF_ACCESS_CLIENT_SECRET must be set")
	}
	httpReq.Header.Set("CF-Access-Client-Id", clientID)
	httpReq.Header.Set("CF-Access-Client-Secret", clientSecret)

	res, err := http.DefaultClient.Do(httpReq)
	if err != nil {
		return "", err
	}
	defer res.Body.Close()

	respBody, err := io.ReadAll(res.Body)
	if err != nil {
		return "", err
	}

	var parsed artifactResponse
	if err := json.Unmarshal(respBody, &parsed); err != nil {
		return "", fmt.Errorf("unexpected response (status %d): %s", res.StatusCode, respBody)
	}
	if res.StatusCode >= 300 {
		return "", fmt.Errorf("api error (status %d): %s", res.StatusCode, parsed.Error)
	}
	return parsed.URL, nil
}
