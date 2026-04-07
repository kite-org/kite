package handlers

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/zxh326/kite/pkg/utils"
	"k8s.io/klog/v2"
)

type ImageTagInfo struct {
	Name      string     `json:"name"`
	Timestamp *time.Time `json:"timestamp,omitempty"`
}

type registry interface {
	GetTags(ctx context.Context) ([]ImageTagInfo, error)
}

type dockerRegistry struct {
	repo string
}

func (d dockerRegistry) GetTags(ctx context.Context) ([]ImageTagInfo, error) {
	url := fmt.Sprintf("https://hub.docker.com/v2/repositories/%s/tags?page_size=10&ordering=last_updated", d.repo)
	klog.V(1).Infof("fetching tags from Docker Hub: %s", url)
	resp, err := http.Get(url)
	if err != nil {
		klog.Errorf("failed to get tags from Docker Hub: %v", err)
		return nil, nil
	}
	defer func() {
		_ = resp.Body.Close()
	}()
	if resp.StatusCode != 200 {
		klog.Errorf("docker hub api error: %s, status: %s", d.repo, resp.Status)
		return nil, nil
	}
	var data struct {
		Results []struct {
			Name        string    `json:"name"`
			LastUpdated time.Time `json:"last_updated"`
		}
	}
	if err := json.NewDecoder(resp.Body).Decode(&data); err != nil {
		return nil, err
	}
	tags := make([]ImageTagInfo, 0, len(data.Results))
	for _, t := range data.Results {
		tags = append(tags, ImageTagInfo{Name: t.Name, Timestamp: &t.LastUpdated})
	}
	return tags, nil
}

type containerRegistryV2 struct {
	baseURL string
	repo    string
}

func (d containerRegistryV2) GetTags(ctx context.Context) ([]ImageTagInfo, error) {
	url := fmt.Sprintf("https://%s/v2/%s/tags/list", d.baseURL, d.repo)
	resp, err := http.Get(url)
	if err != nil {
		klog.Errorf("failed to get tags from registry %s: %v", d.baseURL, err)
		return nil, nil
	}
	defer func() {
		_ = resp.Body.Close()
	}()
	if resp.StatusCode != 200 {
		klog.Errorf("registry v2 api error: %s, status: %s", d.baseURL, resp.Status)
		return nil, nil
	}
	var data struct {
		Tags []string `json:"tags"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&data); err != nil {
		return nil, nil
	}
	tags := make([]ImageTagInfo, 0, len(data.Tags))
	for _, t := range data.Tags {
		if strings.HasPrefix(t, "sha256") {
			// Skip digest tags
			continue
		}
		tags = append(tags, ImageTagInfo{Name: t})
	}
	return tags, nil
}

func getRegistry(image string) registry {
	r, repo := utils.GetImageRegistryAndRepo(image)
	if r == "" || r == "docker.io" {
		return dockerRegistry{repo}
	}
	return containerRegistryV2{baseURL: r, repo: repo}
}

func GetImageTags(c *gin.Context) {
	image := c.Query("image")
	if image == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "image param required"})
		return
	}
	reg := getRegistry(image)
	tags, err := reg.GetTags(c.Request.Context())
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, tags)
}
