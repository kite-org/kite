package handlers

import (
	"fmt"
	"net/http"
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/zxh326/kite/pkg/model"
	"github.com/zxh326/kite/pkg/rbac"
	"k8s.io/klog/v2"
)

type createPasswordUser struct {
	Username string `json:"username" binding:"required"`
	Password string `json:"password" binding:"required"`
	Name     string `json:"name"`
}

func CreateSuperUser(c *gin.Context) {
	var userreq createPasswordUser
	if err := c.ShouldBindJSON(&userreq); err != nil {
		c.JSON(400, gin.H{"error": err.Error()})
		return
	}

	uc, err := model.CountUsers()
	if err != nil {
		c.JSON(500, gin.H{"error": "failed to count users"})
		return
	}

	if uc > 0 {
		c.JSON(http.StatusForbidden, gin.H{"error": "super user already exists"})
		return
	}
	user := &model.User{
		Username: userreq.Username,
		Password: userreq.Password,
		Name:     userreq.Name,
		Provider: "password",
	}

	if err := model.AddSuperUser(user); err != nil {
		c.JSON(500, gin.H{"error": "failed to create super user"})
		return
	}
	rbac.SyncNow <- struct{}{}
	c.JSON(201, user)
}

func CreatePasswordUser(c *gin.Context) {
	var userreq createPasswordUser
	if err := c.ShouldBindJSON(&userreq); err != nil {
		c.JSON(400, gin.H{"error": err.Error()})
		return
	}
	// check only admin or users count is zero
	user := &model.User{
		Username: userreq.Username,
		Password: userreq.Password,
		Name:     userreq.Name,
		Provider: "password",
	}

	_, err := model.GetUserByUsername(user.Username)
	if err == nil {
		c.JSON(400, gin.H{"error": "user already exists"})
		return
	}

	if err := model.AddUser(user); err != nil {
		c.JSON(500, gin.H{"error": "failed to create user"})
		return
	}
	c.JSON(201, user)
}

func ListUsers(c *gin.Context) {
	page := 1
	size := 20
	search := strings.TrimSpace(c.Query("search"))
	role := strings.TrimSpace(c.Query("role"))
	sortBy := strings.TrimSpace(c.Query("sortBy"))
	sortOrder := strings.ToLower(strings.TrimSpace(c.Query("sortOrder")))
	if sortOrder != "asc" && sortOrder != "desc" {
		sortOrder = "desc"
	}
	if p := c.Query("page"); p != "" {
		_, _ = fmt.Sscanf(p, "%d", &page)
		if page <= 0 {
			page = 1
		}
	}
	if s := c.Query("size"); s != "" {
		_, _ = fmt.Sscanf(s, "%d", &size)
		if size <= 0 {
			size = 20
		}
	}
	offset := (page - 1) * size

	users, total, err := model.ListUsers(
		size,
		offset,
		search,
		sortBy,
		sortOrder,
		role,
	)
	if err != nil {
		c.JSON(500, gin.H{"error": "failed to list users"})
		return
	}
	for i := range users {
		users[i].Roles = rbac.GetUserRoles(users[i])
	}
	c.JSON(200, gin.H{"users": users, "total": total, "page": page, "size": size})
}

func UpdateUser(c *gin.Context) {
	var id uint64
	if _, err := fmt.Sscanf(c.Param("id"), "%d", &id); err != nil || id == 0 {
		c.JSON(400, gin.H{"error": "invalid id"})
		return
	}

	var req struct {
		Name      string `json:"name"`
		AvatarURL string `json:"avatar_url,omitempty"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(400, gin.H{"error": err.Error()})
		return
	}

	user, err := model.GetUserByID(id)
	if err != nil {
		c.JSON(404, gin.H{"error": "user not found"})
		return
	}
	if req.Name != "" {
		user.Name = req.Name
	}
	if req.AvatarURL != "" {
		user.AvatarURL = req.AvatarURL
	}

	if err := model.UpdateUser(user); err != nil {
		c.JSON(500, gin.H{"error": "failed to update user"})
		return
	}
	c.JSON(200, user)
}

func DeleteUser(c *gin.Context) {
	var id uint
	if _, err := fmt.Sscanf(c.Param("id"), "%d", &id); err != nil || id == 0 {
		c.JSON(400, gin.H{"error": "invalid id"})
		return
	}

	if err := model.DeleteUserByID(id); err != nil {
		c.JSON(500, gin.H{"error": "failed to delete user"})
		return
	}
	c.JSON(200, gin.H{"success": true})
}

func ResetPassword(c *gin.Context) {
	var id uint
	if _, err := fmt.Sscanf(c.Param("id"), "%d", &id); err != nil || id == 0 {
		c.JSON(400, gin.H{"error": "invalid id"})
		return
	}
	var req struct {
		Password string `json:"password" binding:"required"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(400, gin.H{"error": err.Error()})
		return
	}
	if err := model.ResetPasswordByID(id, req.Password); err != nil {
		c.JSON(500, gin.H{"error": "failed to reset password"})
		return
	}
	c.JSON(200, gin.H{"success": true})
}

func SetUserEnabled(c *gin.Context) {
	var id uint
	if _, err := fmt.Sscanf(c.Param("id"), "%d", &id); err != nil || id == 0 {
		c.JSON(400, gin.H{"error": "invalid id"})
		return
	}
	var req struct {
		Enabled bool `json:"enabled"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(400, gin.H{"error": err.Error()})
		return
	}
	if err := model.SetUserEnabled(id, req.Enabled); err != nil {
		c.JSON(500, gin.H{"error": "failed to set enabled"})
		return
	}
	c.JSON(200, gin.H{"success": true})
}

func UpdateSidebarPreference(c *gin.Context) {
	user := c.MustGet("user").(model.User)
	isAdmin := rbac.UserHasRole(user, model.DefaultAdminRole.Name)
	if !isAdmin {
		setting, err := model.GetGeneralSetting()
		if err != nil {
			c.JSON(500, gin.H{"error": "failed to load general setting"})
			return
		}
		if strings.TrimSpace(setting.GlobalSidebarPreference) != "" {
			c.JSON(http.StatusForbidden, gin.H{"error": "sidebar customization is disabled by global sidebar"})
			return
		}
	}
	var req struct {
		SidebarPreference string `json:"sidebar_preference" binding:"required"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(400, gin.H{"error": err.Error()})
		return
	}
	user.SidebarPreference = req.SidebarPreference
	if err := model.UpdateUser(&user); err != nil {
		klog.Errorf("failed to update sidebar preference for user %s: %v", user.Username, err)
		c.JSON(500, gin.H{"error": "failed to update sidebar preference"})
		return
	}
	c.JSON(200, gin.H{"success": true})
}

func UpdateGlobalSidebarPreference(c *gin.Context) {
	var req struct {
		SidebarPreference string `json:"sidebar_preference" binding:"required"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(400, gin.H{"error": err.Error()})
		return
	}
	if _, err := model.UpdateGeneralSetting(map[string]interface{}{
		"global_sidebar_preference": req.SidebarPreference,
	}); err != nil {
		klog.Errorf("failed to update global sidebar preference: %v", err)
		c.JSON(500, gin.H{"error": "failed to update global sidebar preference"})
		return
	}
	c.JSON(200, gin.H{"success": true})
}

func ClearGlobalSidebarPreference(c *gin.Context) {
	if _, err := model.UpdateGeneralSetting(map[string]interface{}{
		"global_sidebar_preference": "",
	}); err != nil {
		klog.Errorf("failed to clear global sidebar preference: %v", err)
		c.JSON(500, gin.H{"error": "failed to clear global sidebar preference"})
		return
	}
	c.JSON(200, gin.H{"success": true})
}
