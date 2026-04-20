package rbac

import (
	"net/http"
	"strconv"

	"github.com/gin-gonic/gin"
	"github.com/zxh326/kite/pkg/common"
	"github.com/zxh326/kite/pkg/model"
)

// ListRoles returns all roles with assignments
func ListRoles(c *gin.Context) {
	var roles []model.Role
	if err := model.DB.Preload("Assignments").Find(&roles).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to list roles: " + err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"roles": roles})
}

// GetRole returns a single role by id
func GetRole(c *gin.Context) {
	id := c.Param("id")
	dbID, err := strconv.ParseUint(id, 10, 32)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid role id"})
		return
	}
	var role model.Role
	if err := model.DB.Preload("Assignments").First(&role, uint(dbID)).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "role not found"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"role": role})
}

// CreateRole creates a new role
func CreateRole(c *gin.Context) {
	if common.IsSectionManaged("rbac") {
		c.JSON(http.StatusForbidden, gin.H{"error": common.ManagedSectionError})
		return
	}

	var role model.Role
	if err := c.ShouldBindJSON(&role); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	if role.Name == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "role name is required"})
		return
	}
	if err := model.DB.Create(&role).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to create role: " + err.Error()})
		return
	}
	// refresh in-memory config
	TriggerSync()
	c.JSON(http.StatusCreated, gin.H{"role": role})
}

// UpdateRole updates an existing role
func UpdateRole(c *gin.Context) {
	if common.IsSectionManaged("rbac") {
		c.JSON(http.StatusForbidden, gin.H{"error": common.ManagedSectionError})
		return
	}

	id := c.Param("id")
	dbID, err := strconv.ParseUint(id, 10, 32)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid role id"})
		return
	}
	var req model.Role
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	var role model.Role
	if err := model.DB.First(&role, uint(dbID)).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "role not found"})
		return
	}
	// update fields
	role.Name = req.Name
	role.Description = req.Description
	role.Clusters = req.Clusters
	role.Namespaces = req.Namespaces
	role.Resources = req.Resources
	role.Verbs = req.Verbs

	if err := model.DB.Save(&role).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to update role: " + err.Error()})
		return
	}
	TriggerSync()
	c.JSON(http.StatusOK, gin.H{"role": role})
}

// DeleteRole deletes a role and its assignments
func DeleteRole(c *gin.Context) {
	if common.IsSectionManaged("rbac") {
		c.JSON(http.StatusForbidden, gin.H{"error": common.ManagedSectionError})
		return
	}

	id := c.Param("id")
	dbID, err := strconv.ParseUint(id, 10, 32)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid role id"})
		return
	}
	if err := model.DB.Delete(&model.Role{}, uint(dbID)).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to delete role: " + err.Error()})
		return
	}
	TriggerSync()
	c.JSON(http.StatusOK, gin.H{"success": true})
}

// Assignment APIs
type roleAssignmentReq struct {
	SubjectType string `json:"subjectType" binding:"required"`
	Subject     string `json:"subject" binding:"required"`
}

// AssignRole assigns a role to a user or group
func AssignRole(c *gin.Context) {
	if common.IsSectionManaged("rbac") {
		c.JSON(http.StatusForbidden, gin.H{"error": common.ManagedSectionError})
		return
	}

	id := c.Param("id")
	dbID, err := strconv.ParseUint(id, 10, 32)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid role id"})
		return
	}
	var req roleAssignmentReq
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	// validate subject type
	if req.SubjectType != model.SubjectTypeUser && req.SubjectType != model.SubjectTypeGroup {
		c.JSON(http.StatusBadRequest, gin.H{"error": "subjectType must be 'user' or 'group'"})
		return
	}
	// ensure role exists
	var role model.Role
	if err := model.DB.First(&role, uint(dbID)).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "role not found"})
		return
	}

	// check exists
	var existing model.RoleAssignment
	if err := model.DB.Where("role_id = ? AND subject_type = ? AND subject = ?", role.ID, req.SubjectType, req.Subject).First(&existing).Error; err == nil {
		c.JSON(http.StatusOK, gin.H{"assignment": existing})
		return
	}

	assignment := model.RoleAssignment{
		RoleID:      role.ID,
		SubjectType: req.SubjectType,
		Subject:     req.Subject,
	}
	if err := model.DB.Create(&assignment).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to create assignment: " + err.Error()})
		return
	}
	TriggerSync()
	c.JSON(http.StatusCreated, gin.H{"assignment": assignment})
}

// UnassignRole removes an assignment. Accepts query params subjectType and subject.
func UnassignRole(c *gin.Context) {
	if common.IsSectionManaged("rbac") {
		c.JSON(http.StatusForbidden, gin.H{"error": common.ManagedSectionError})
		return
	}

	id := c.Param("id")
	dbID, err := strconv.ParseUint(id, 10, 32)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid role id"})
		return
	}
	subjectType := c.Query("subjectType")
	subject := c.Query("subject")
	if subjectType == "" || subject == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "subjectType and subject query params are required"})
		return
	}
	if err := model.DB.Where("role_id = ? AND subject_type = ? AND subject = ?", uint(dbID), subjectType, subject).Delete(&model.RoleAssignment{}).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to remove assignment: " + err.Error()})
		return
	}
	TriggerSync()
	c.JSON(http.StatusOK, gin.H{"success": true})
}
