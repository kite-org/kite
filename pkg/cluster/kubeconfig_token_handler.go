package cluster

import (
	"net/http"
	"strconv"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/zxh326/kite/pkg/model"
)

type kubeconfigTokenResponse struct {
	ID           uint    `json:"id"`
	Name         string  `json:"name"`
	OwnerID      uint    `json:"ownerId,omitempty"`
	Owner        string  `json:"owner,omitempty"`
	CreatedAt    string  `json:"createdAt"`
	ExpiresAt    string  `json:"expiresAt"`
	LastUsedAt   *string `json:"lastUsedAt,omitempty"`
	SigningKeyID string  `json:"signingKeyId"`
}

func kubeconfigTokenDTO(token model.KubeconfigToken, includeOwner bool) kubeconfigTokenResponse {
	result := kubeconfigTokenResponse{ID: token.ID, Name: token.Name, CreatedAt: token.CreatedAt.UTC().Format(time.RFC3339), ExpiresAt: token.ExpiresAt.UTC().Format(time.RFC3339), SigningKeyID: token.SigningKeyID}
	if token.LastUsedAt != nil {
		value := token.LastUsedAt.UTC().Format(time.RFC3339)
		result.LastUsedAt = &value
	}
	if includeOwner {
		result.OwnerID = token.OwnerID
		if token.Owner != nil {
			result.Owner = token.Owner.Key()
		}
	}
	return result
}

func listKubeconfigTokenResponses(c *gin.Context, ownerID uint, includeOwner bool) {
	tokens, err := model.ListKubeconfigTokens(ownerID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to list kubeconfig tokens"})
		return
	}
	result := make([]kubeconfigTokenResponse, 0, len(tokens))
	for _, token := range tokens {
		result = append(result, kubeconfigTokenDTO(token, includeOwner))
	}
	c.JSON(http.StatusOK, gin.H{"tokens": result})
}

func ListCurrentUserKubeconfigTokens(c *gin.Context) {
	user := c.MustGet("user").(model.User)
	listKubeconfigTokenResponses(c, user.ID, false)
}

func ListAllKubeconfigTokens(c *gin.Context) {
	page, size, ok := parseKubeconfigTokenPagination(c)
	if !ok {
		return
	}
	status := c.Query("status")
	if status != "" && status != "active" && status != "expired" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid status"})
		return
	}
	tokens, total, err := model.ListAdminKubeconfigTokens(model.KubeconfigTokenListOptions{
		Page: page, Size: size, Owner: c.Query("owner"), Status: status,
	})
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to list kubeconfig tokens"})
		return
	}
	result := make([]kubeconfigTokenResponse, 0, len(tokens))
	for _, token := range tokens {
		result = append(result, kubeconfigTokenDTO(token, true))
	}
	c.JSON(http.StatusOK, gin.H{"tokens": result, "total": total, "page": page, "size": size})
}

func parseKubeconfigTokenPagination(c *gin.Context) (int, int, bool) {
	page, size := 1, 20
	var err error
	if value := c.Query("page"); value != "" {
		page, err = strconv.Atoi(value)
		if err != nil || page < 1 {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid page"})
			return 0, 0, false
		}
	}
	if value := c.Query("size"); value != "" {
		size, err = strconv.Atoi(value)
		if err != nil || size < 1 || size > 100 {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid size"})
			return 0, 0, false
		}
	}
	return page, size, true
}

func deleteKubeconfigToken(c *gin.Context, ownerID *uint) {
	id, err := strconv.ParseUint(c.Param("id"), 10, 32)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid ID"})
		return
	}
	service, err := newKubeconfigTokenService()
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "kubeconfig token service is unavailable"})
		return
	}
	var ownerSubject *string
	if ownerID != nil {
		value := strconv.FormatUint(uint64(*ownerID), 10)
		ownerSubject = &value
	}
	deleted, err := service.Delete(c.Request.Context(), uint(id), ownerSubject)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to delete kubeconfig token"})
		return
	}
	if !deleted {
		c.JSON(http.StatusNotFound, gin.H{"error": "kubeconfig token not found"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"message": "kubeconfig token deleted"})
}

func DeleteCurrentUserKubeconfigToken(c *gin.Context) {
	user := c.MustGet("user").(model.User)
	deleteKubeconfigToken(c, &user.ID)
}
func DeleteAnyKubeconfigToken(c *gin.Context) { deleteKubeconfigToken(c, nil) }
