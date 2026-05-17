package apikeys

import (
	"fmt"
	"net/http"
	"strconv"

	"github.com/gin-gonic/gin"
	"github.com/zxh326/kite/pkg/model"
	"github.com/zxh326/kite/pkg/rbac"
)

type CreateAPIKeyRequest struct {
	Name string `json:"name" binding:"required"`
}

func ListAPIKeys(c *gin.Context) {
	apiKeys, err := model.ListAPIKeyUsers()
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to list API keys"})
		return
	}
	for i := range apiKeys {
		apiKeys[i].Roles = rbac.GetUserRoles(apiKeys[i])
		apiKeys[i].APIKey = model.SecretString(apiKeys[i].GetAPIKey())
	}
	c.JSON(http.StatusOK, gin.H{"apiKeys": apiKeys})
}

func CreateAPIKey(c *gin.Context) {
	var req CreateAPIKeyRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	apiKey, err := model.NewAPIKeyUser(req.Name)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": fmt.Sprintf("failed to create API key: %v", err)})
		return
	}
	c.JSON(http.StatusCreated, gin.H{"apiKey": apiKey})
}

func DeleteAPIKey(c *gin.Context) {
	idStr := c.Param("id")
	id, err := strconv.ParseUint(idStr, 10, 32)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid ID"})
		return
	}

	if err := model.DeleteUserByID(uint(id)); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to delete API key"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"message": "API key deleted successfully"})
}
