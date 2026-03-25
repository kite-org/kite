package model

import (
	"errors"
	"fmt"
	"strings"
	"time"

	expirable "github.com/hashicorp/golang-lru/v2/expirable"
	"github.com/zxh326/kite/pkg/common"
	"github.com/zxh326/kite/pkg/utils"
	"gorm.io/gorm"
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

// userCache is a thread-safe LRU with 30s TTL.
// Eliminates the per-request SELECT in RequireAuth (~1-5ms → ~50ns).
// Capacity 256 is generous for a K8s dashboard user base.
var userCache = expirable.NewLRU[uint64, *User](256, nil, 30*time.Second)

// GetUserByIDCached returns the user from cache if available, otherwise
// fetches from DB and stores it.  Used on the hot auth path.
func GetUserByIDCached(id uint64) (*User, error) {
	if u, ok := userCache.Get(id); ok {
		// Return a shallow copy so callers (RequireAuth, etc.) can safely
		// mutate fields like Roles without racing on the cached pointer.
		copy := *u
		return &copy, nil
	}
	u, err := GetUserByID(id)
	if err != nil {
		return nil, err
	}
	userCache.Add(id, u)
	// Also return a copy on miss path to keep the cached entry immutable.
	copy := *u
	return &copy, nil
}

// InvalidateUserCache removes a user from the auth cache.
// Called after every successful mutation so that security-sensitive changes
// (disable, delete, password reset) take effect on the next auth check.
func InvalidateUserCache(id uint64) {
	userCache.Remove(id)
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
			return DB.Create(user).Error
		}
		return err
	}
	user.Enabled = existingUser.Enabled

	user.ID = existingUser.ID
	user.CreatedAt = existingUser.CreatedAt
	user.SidebarPreference = existingUser.SidebarPreference
	err := DB.Save(user).Error
	InvalidateUserCache(uint64(user.ID))
	return err
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
	err := DB.Delete(&User{}, id).Error
	InvalidateUserCache(uint64(id))
	return err
}

// UpdateUser saves provided user (expects ID set)
func UpdateUser(user *User) error {
	err := DB.Save(user).Error
	InvalidateUserCache(uint64(user.ID))
	return err
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
	err = DB.Save(&u).Error
	InvalidateUserCache(uint64(id))
	return err
}

// SetUserEnabled sets enabled flag for a user
func SetUserEnabled(id uint, enabled bool) error {
	err := DB.Model(&User{}).Where("id = ?", id).Update("enabled", enabled).Error
	InvalidateUserCache(uint64(id))
	return err
}

func CheckPassword(hashedPassword, plainPassword string) bool {
	return utils.CheckPasswordHash(plainPassword, hashedPassword)
}

func UpsertLDAPUser(user *User) (*User, error) {
	if user == nil {
		return nil, errors.New("user is nil")
	}

	user.Username = strings.TrimSpace(user.Username)
	if user.Username == "" {
		return nil, errors.New("username is empty")
	}

	now := time.Now()
	user.Provider = AuthProviderLDAP
	user.Password = ""
	user.LastLoginAt = &now

	var existingUser User
	if err := DB.Where("username = ?", user.Username).First(&existingUser).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			user.Enabled = true
			if strings.TrimSpace(user.Name) == "" {
				user.Name = user.Username
			}
			err = DB.Create(user).Error
			if err == nil {
				InvalidateUserCache(uint64(user.ID))
				return user, nil
			}
			if !isUniqueConstraintError(err) {
				return nil, err
			}
			if err := DB.Where("username = ?", user.Username).First(&existingUser).Error; err != nil {
				return nil, err
			}
		} else {
			return nil, err
		}
	}

	if existingUser.Provider != AuthProviderLDAP {
		return nil, ErrUserProviderConflict
	}

	user.ID = existingUser.ID
	user.CreatedAt = existingUser.CreatedAt
	user.Enabled = existingUser.Enabled
	user.SidebarPreference = existingUser.SidebarPreference
	user.Sub = existingUser.Sub
	if strings.TrimSpace(user.Name) == "" {
		user.Name = existingUser.Name
	}
	if strings.TrimSpace(user.AvatarURL) == "" {
		user.AvatarURL = existingUser.AvatarURL
	}

	err := DB.Save(user).Error
	if err == nil {
		InvalidateUserCache(uint64(user.ID))
	}
	return user, err
}

func isUniqueConstraintError(err error) bool {
	if err == nil {
		return false
	}
	if errors.Is(err, gorm.ErrDuplicatedKey) {
		return true
	}
	message := strings.ToLower(err.Error())
	return strings.Contains(message, "unique constraint failed") ||
		strings.Contains(message, "duplicate key value") ||
		strings.Contains(message, "duplicate entry")
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
	ErrUserProviderConflict = errors.New("user exists with different provider")

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
