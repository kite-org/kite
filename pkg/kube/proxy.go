package kube

import (
	"context"
	"errors"
	"io"
	"net/http"
	"net/url"
	"strings"

	"github.com/gin-gonic/gin"
	"k8s.io/client-go/rest"
	"k8s.io/klog/v2"
)

func HandleProxy(c *gin.Context, client *K8sClient, kind, namespace, name, proxyPath string) {
	restConfig := rest.CopyConfig(client.Configuration)
	httpClient, err := rest.HTTPClientFor(restConfig)
	if err != nil {
		klog.Errorf("failed to build kubernetes http client: %v", err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to initialize kubernetes client"})
		return
	}
	targetURL, err := buildProxyURL(restConfig.Host, kind, namespace, name, proxyPath, c.Request.URL.RawQuery)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	req, err := http.NewRequestWithContext(c.Request.Context(), c.Request.Method, targetURL, c.Request.Body)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to create proxy request"})
		return
	}
	req.Header = cloneHeader(c.Request.Header)
	req.Header.Del("Authorization")
	req.Header.Del("Cookie")
	req.Header.Del("Connection")
	req.Header.Del("Upgrade")
	req.Header.Del("Keep-Alive")
	req.Header.Del("Proxy-Connection")
	req.Header.Del("Transfer-Encoding")

	resp, err := httpClient.Do(req)

	if err != nil {
		klog.Errorf("proxy request failed: %v", err)
		c.JSON(http.StatusBadGateway, gin.H{"error": "upstream request failed"})
		return
	}
	defer func() {
		_ = resp.Body.Close()
	}()

	copyHeader(c.Writer.Header(), resp.Header)
	c.Writer.WriteHeader(resp.StatusCode)
	if _, err := io.Copy(c.Writer, resp.Body); err != nil {
		if !errors.Is(err, context.Canceled) {
			klog.Errorf("failed to write proxy response: %v", err)
		}
	}
}

func buildProxyURL(host, kind, namespace, name, proxyPath, rawQuery string) (string, error) {
	base, err := url.JoinPath(host, "api/v1/namespaces", namespace, kind, name, "proxy")
	if err != nil {
		return "", err
	}

	for _, segment := range strings.Split(proxyPath, "/") {
		if segment == ".." {
			return "", errors.New("invalid proxy path: path traversal detected")
		}
	}

	u, err := url.Parse(base)
	if err != nil {
		return "", err
	}
	u.Path = strings.TrimSuffix(u.Path, "/") + "/" + strings.TrimPrefix(proxyPath, "/")
	u.RawPath = ""

	query, err := url.ParseQuery(rawQuery)
	if err != nil {
		return "", err
	}
	u.RawQuery = query.Encode()
	return u.String(), nil
}

func cloneHeader(h http.Header) http.Header {
	cloned := make(http.Header, len(h))
	for k, values := range h {
		for _, v := range values {
			cloned.Add(k, v)
		}
	}
	return cloned
}

func copyHeader(dst, src http.Header) {
	for k, values := range src {
		for _, v := range values {
			dst.Add(k, v)
		}
	}
}
