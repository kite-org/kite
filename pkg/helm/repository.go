package helm

import (
	"fmt"
	"net/http"
	"net/url"
	"strconv"
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/zxh326/kite/pkg/helmutil"
	"github.com/zxh326/kite/pkg/model"
	"helm.sh/helm/v4/pkg/registry"
)

func validateOCIRepositoryURL(repositoryURL *url.URL) error {
	if _, err := helmutil.OCIChartName(repositoryURL.String()); err != nil {
		return err
	}
	if helmutil.OCIRefHasTagOrDigest(repositoryURL) {
		return fmt.Errorf("oci repository URL must not include a tag or digest")
	}
	return nil
}

func (h *HelmChartHandler) ListRepositories(c *gin.Context) {
	var repositories []model.HelmRepository
	if err := model.DB.Order("name").Find(&repositories).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	items := make([]helmRepositoryResponse, 0, len(repositories))
	for _, repository := range repositories {
		items = append(items, toHelmRepositoryResponse(repository))
	}
	c.JSON(http.StatusOK, items)
}

func (h *HelmChartHandler) CreateRepository(c *gin.Context) {
	var req createHelmRepositoryRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	repository := model.HelmRepository{
		Name:     strings.TrimSpace(req.Name),
		URL:      strings.TrimSpace(req.URL),
		Username: strings.TrimSpace(req.Username),
		Password: model.SecretString(req.Password),
	}

	if repository.Name == "" || repository.URL == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "repository name and URL are required"})
		return
	}
	if strings.Contains(repository.Name, "/") {
		c.JSON(http.StatusBadRequest, gin.H{"error": "repository name cannot contain /"})
		return
	}
	if (repository.Username == "") != (repository.Password == "") {
		c.JSON(http.StatusBadRequest, gin.H{"error": "repository username and password must be provided together"})
		return
	}

	repositoryURL, err := url.Parse(repository.URL)
	if err != nil || repositoryURL.Scheme == "" || repositoryURL.Host == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "repository URL must be absolute"})
		return
	}
	scheme := strings.ToLower(repositoryURL.Scheme)
	if scheme != "http" && scheme != "https" && scheme != registry.OCIScheme {
		c.JSON(http.StatusBadRequest, gin.H{"error": "repository URL must use http, https, or oci"})
		return
	}
	repository.URL = scheme + repository.URL[len(scheme):]
	if scheme == registry.OCIScheme {
		repository.URL = strings.TrimRight(repository.URL, "/")
		if err := validateOCIRepositoryURL(repositoryURL); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
			return
		}
	}

	var count int64
	if err := model.DB.Model(&model.HelmRepository{}).Where("name = ?", repository.Name).Count(&count).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	if count > 0 {
		c.JSON(http.StatusConflict, gin.H{"error": "repository name already exists"})
		return
	}

	if _, err := h.loadRepositoryIndex(repository); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	if err := model.DB.Create(&repository).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusCreated, toHelmRepositoryResponse(repository))
}

func (h *HelmChartHandler) DeleteRepository(c *gin.Context) {
	id, err := strconv.Atoi(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	var repository model.HelmRepository
	if err := model.DB.First(&repository, id).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "repository not found"})
		return
	}

	if err := model.DB.Delete(&repository).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	h.clearRepositoryCache(repository)

	c.JSON(http.StatusOK, gin.H{"message": "repository deleted"})
}

func toHelmRepositoryResponse(repository model.HelmRepository) helmRepositoryResponse {
	return helmRepositoryResponse{
		ID:        repository.ID,
		Name:      repository.Name,
		URL:       repository.URL,
		Username:  repository.Username,
		HasAuth:   repository.Username != "",
		CreatedAt: repository.CreatedAt,
		UpdatedAt: repository.UpdatedAt,
	}
}
