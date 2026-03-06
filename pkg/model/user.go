package model

import (
	"errors"
	"fmt"
	"time"

	"github.com/zxh326/kite/pkg/common"
	"github.com/zxh326/kite/pkg/utils"
	"gorm.io/gorm"
	"k8s.io/klog/v2"
)

type User struct {
	Model
	Username    string      `json:"username" gorm:"type:varchar(50);uniqueIndex;not null"`
	Password    string      `json:"-" gorm:"type:varchar(255)"`
	Name        string      `json:"name,omitempty" gorm:"type:varchar(100);index"`
	AvatarURL   string      `json:"avatar_url,omitempty" gorm:"type:varchar(500)"`
	Provider    string      `json:"provider,omitempty" gorm:"type:varchar(50);default:password;index"`
	OIDCGroups  SliceString `json:"oidc_groups,omitempty" gorm:"type:text"`
	LastLoginAt *time.Time  `json:"lastLoginAt,omitempty" gorm:"type:timestamp;index"`
	Enabled     bool        `json:"enabled" gorm:"type:boolean;default:true"`
	Sub         string      `json:"sub,omitempty" gorm:"type:varchar(255);index"`

	APIKey SecretString  `json:"apiKey,omitempty" gorm:"type:text"`
	Roles  []common.Role `json:"roles,omitempty" gorm:"-"`

	SidebarPreference string `json:"sidebar_preference,omitempty" gorm:"type:text"`
}

func (u *User) Key() string {
	if u.Username != "" {
		return u.Username
	}
	if u.Name != "" {
		return u.Name
	}
	if u.Sub != "" {
		return u.Sub
	}
	return fmt.Sprintf("%d", u.ID)
}

func (u *User) GetAPIKey() string {
	return fmt.Sprintf("kite%d-%s", u.ID, string(u.APIKey))
}

func AddUser(user *User) error {
	// Hash the password before storing it
	hash, err := utils.HashPassword(user.Password)
	if err != nil {
		return err
	}
	user.Password = hash
	return DB.Create(user).Error
}

func CountUsers() (count int64, err error) {
	return count, DB.Model(&User{}).Count(&count).Error
}

func GetUserByID(id uint64) (*User, error) {
	var user User
	if err := DB.Where("id = ?", id).First(&user).Error; err != nil {
		return nil, err
	}
	return &user, nil
}

func GetAnonymousUser() *User {
	user := &User{}
	if err := DB.Where("username = ? AND provider = ?", "anonymous", "Anonymous").First(user).Error; err != nil {
		return nil
	}
	return user
}

func FindWithSubOrUpsertUser(user *User) error {
	if user.Sub == "" {
		return errors.New("user sub is empty")
	}
	var existingUser User
	now := time.Now()
	user.LastLoginAt = &now
	if err := DB.Where("sub = ?", user.Sub).First(&existingUser).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			if err := DB.Create(user).Error; err != nil {
				return err
			}
			// Assign default viewer role to new user
			if err := AddRoleAssignment("viewer", SubjectTypeUser, user.Username); err != nil {
				klog.Warningf("Failed to assign default viewer role to user %s: %v", user.Username, err)
			} else {
				klog.Infof("Assigned default viewer role to user %s", user.Username)
			}
			return nil
		}
		return err
	}
	user.Enabled = existingUser.Enabled

	user.ID = existingUser.ID
	user.CreatedAt = existingUser.CreatedAt
	user.SidebarPreference = existingUser.SidebarPreference
	return DB.Save(user).Error
}

func GetUserByUsername(username string) (*User, error) {
	var user User
	if err := DB.Where("username = ?", username).First(&user).Error; err != nil {
		return nil, err
	}
	return &user, nil
}

// ListUsers returns users with pagination. If limit is 0, defaults to 20.
func ListUsers(limit int, offset int, search string, sortBy string, sortOrder string, role string) (users []User, total int64, err error) {
	if limit <= 0 {
		limit = 20
	}
	query := DB.Model(&User{}).Where("users.provider != ?", common.APIKeyProvider)
	if role != "" {
		query = query.Joins(
			"JOIN role_assignments ra ON ra.subject = users.username AND ra.subject_type = ?",
			SubjectTypeUser,
		).Joins("JOIN roles r ON r.id = ra.role_id").Where("r.name = ?", role)
	}
	if search != "" {
		likeQuery := "%" + search + "%"
		query = query.Where(
			"users.username LIKE ? OR users.name LIKE ?",
			likeQuery,
			likeQuery,
		)
	}
	countQuery := query.Select("users.id").Distinct("users.id")
	err = DB.Table("(?) as sub", countQuery).Count(&total).Error
	if err != nil {
		return nil, 0, err
	}
	if sortOrder != "asc" && sortOrder != "desc" {
		sortOrder = "desc"
	}
	allowedSorts := map[string]string{
		"id":          "users.id",
		"createdAt":   "users.created_at",
		"lastLoginAt": "users.last_login_at",
	}
	sortColumn, ok := allowedSorts[sortBy]
	if !ok {
		sortColumn = "users.id"
	}
	orderExpr := fmt.Sprintf("%s %s", sortColumn, sortOrder)
	if sortColumn == "users.last_login_at" {
		orderExpr = fmt.Sprintf("users.last_login_at IS NULL, users.last_login_at %s", sortOrder)
	}
	var userIds []uint
	idsQuery := query.
		Select("users.id").
		Distinct("users.id").
		Order(orderExpr).
		Limit(limit).
		Offset(offset)
	err = idsQuery.Pluck("users.id", &userIds).Error
	if err != nil {
		return nil, 0, err
	}
	err = DB.
		Where("id IN (?)", userIds).
		Order(orderExpr).
		Find(&users).Error
	if err != nil {
		return nil, 0, err
	}
	return users, total, nil
}

func LoginUser(u *User) error {
	now := time.Now()
	u.LastLoginAt = &now
	return DB.Save(u).Error
}

// DeleteUserByID removes a user by ID
func DeleteUserByID(id uint) error {
	_ = DB.Where("operator_id = ?", id).Delete(&ResourceHistory{}).Error
	return DB.Delete(&User{}, id).Error
}

// UpdateUser saves provided user (expects ID set)
func UpdateUser(user *User) error {
	return DB.Save(user).Error
}

// ResetPasswordByID sets a new password (hashed) for user with given id
func ResetPasswordByID(id uint, plainPassword string) error {
	var u User
	if err := DB.First(&u, id).Error; err != nil {
		return err
	}
	hash, err := utils.HashPassword(plainPassword)
	if err != nil {
		return err
	}
	u.Password = hash
	return DB.Save(&u).Error
}

// SetUserEnabled sets enabled flag for a user
func SetUserEnabled(id uint, enabled bool) error {
	return DB.Model(&User{}).Where("id = ?", id).Update("enabled", enabled).Error
}

func CheckPassword(hashedPassword, plainPassword string) bool {
	return utils.CheckPasswordHash(plainPassword, hashedPassword)
}

func AddSuperUser(user *User) error {
	if user == nil {
		return errors.New("user is nil")
	}
	if err := AddUser(user); err != nil {
		return err
	}
	if err := AddRoleAssignment("admin", SubjectTypeUser, user.Username); err != nil {
		return err
	}
	return nil
}

func NewAPIKeyUser(name string) (*User, error) {
	apiKey := utils.RandomString(32)
	u := &User{
		Username: name,
		APIKey:   SecretString(apiKey),
		Provider: common.APIKeyProvider,
	}
	return u, DB.Save(u).Error
}

func ListAPIKeyUsers() (users []User, err error) {
	err = DB.Order("id desc").Where("provider = ?", common.APIKeyProvider).Find(&users).Error
	return users, err
}

var (
	AnonymousUser = User{
		Model: Model{
			ID: 0,
		},
		Username: "anonymous",
		Provider: "Anonymous",
		Roles: []common.Role{
			{
				Name:       "admin",
				Clusters:   []string{"*"},
				Resources:  []string{"*"},
				Namespaces: []string{"*"},
				Verbs:      []string{"*"},
			},
		},
	}
)
