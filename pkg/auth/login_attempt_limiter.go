package auth

import (
	"net"
	"sync"
	"time"

	"k8s.io/klog/v2"
)

const (
	credentialLoginMaxFailures   = 10
	credentialLoginFailureWindow = time.Minute
	credentialLoginBlockDuration = 5 * time.Minute

	tooManyCredentialLoginAttemptsError = "too many login attempts, please try again later"
)

type credentialLoginAttemptState struct {
	failures     []time.Time
	blockedUntil time.Time
}

type credentialLoginAttemptLimiter struct {
	mu       sync.Mutex
	attempts map[string]credentialLoginAttemptState
}

var credentialLoginAttempts = &credentialLoginAttemptLimiter{
	attempts: map[string]credentialLoginAttemptState{},
}

func (l *credentialLoginAttemptLimiter) isBlocked(ip string) bool {
	if isCredentialLoginLoopbackIP(ip) {
		return false
	}

	l.mu.Lock()
	defer l.mu.Unlock()

	state, ok := l.attempts[ip]
	if !ok {
		return false
	}
	now := time.Now()
	if !state.blockedUntil.IsZero() && now.Before(state.blockedUntil) {
		return true
	}

	state.blockedUntil = time.Time{}
	state.failures = recentCredentialLoginFailures(state.failures, now)
	if len(state.failures) == 0 {
		delete(l.attempts, ip)
		return false
	}
	l.attempts[ip] = state
	return false
}

func (l *credentialLoginAttemptLimiter) recordFailure(ip string) bool {
	if isCredentialLoginLoopbackIP(ip) {
		return false
	}

	l.mu.Lock()
	defer l.mu.Unlock()

	now := time.Now()
	state := l.attempts[ip]
	if !state.blockedUntil.IsZero() {
		if now.Before(state.blockedUntil) {
			return true
		}
		state = credentialLoginAttemptState{}
	}

	state.failures = append(recentCredentialLoginFailures(state.failures, now), now)
	if len(state.failures) > credentialLoginMaxFailures {
		state.blockedUntil = now.Add(credentialLoginBlockDuration)
		klog.Infof("Blocked credential login attempts from IP %s for %s after %d failures within %s", ip, credentialLoginBlockDuration, len(state.failures), credentialLoginFailureWindow)
	}
	l.attempts[ip] = state
	return !state.blockedUntil.IsZero()
}

func recentCredentialLoginFailures(failures []time.Time, now time.Time) []time.Time {
	cutoff := now.Add(-credentialLoginFailureWindow)
	recent := failures[:0]
	for _, failedAt := range failures {
		if !failedAt.Before(cutoff) {
			recent = append(recent, failedAt)
		}
	}
	return recent
}

func isCredentialLoginLoopbackIP(ip string) bool {
	parsed := net.ParseIP(ip)
	return parsed != nil && parsed.IsLoopback()
}
