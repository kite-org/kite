// API client with authentication support
import { appendCurrentClusterHeader } from './current-cluster'
import { withSubPath } from './subpath'

export interface ApiRequestOptions extends RequestInit {
  retryOnUnauthorized?: boolean
}

class ApiClient {
  private baseUrl: string = ''
  private isRefreshing = false
  private refreshPromise: Promise<void> | null = null

  constructor(baseUrl: string = '') {
    this.baseUrl = baseUrl
  }

  private async refreshToken(): Promise<void> {
    if (this.isRefreshing) {
      return this.refreshPromise!
    }

    this.isRefreshing = true
    this.refreshPromise = fetch(withSubPath('/api/auth/refresh'), {
      method: 'POST',
      credentials: 'include',
    })
      .then((response) => {
        if (!response.ok) {
          throw new Error('Token refresh failed')
        }
      })
      .finally(() => {
        this.isRefreshing = false
        this.refreshPromise = null
      })

    return this.refreshPromise
  }

  async request(
    url: string,
    options: ApiRequestOptions = {}
  ): Promise<Response> {
    const fullUrl = withSubPath(this.baseUrl + url)

    const headers: Record<string, string> = {
      ...(options.headers as Record<string, string>),
    }

    // Only set default Content-Type to application/json if not already set and body is not FormData
    if (!headers['Content-Type'] && !(options.body instanceof FormData)) {
      headers['Content-Type'] = 'application/json'
    }

    appendCurrentClusterHeader(headers)

    const defaultOptions: RequestInit = {
      credentials: 'include',
      headers,
      ...options,
    }

    try {
      let response = await fetch(fullUrl, defaultOptions)

      if (response.status === 401 && options.retryOnUnauthorized !== false) {
        try {
          await this.refreshToken()
          response = await fetch(fullUrl, defaultOptions)
        } catch (refreshError) {
          console.error('Token refresh failed:', refreshError)
          window.location.href = withSubPath('/login')
          throw new Error('Authentication failed')
        }
      }

      return response
    } catch (error) {
      console.error('API request failed:', error)
      throw error
    }
  }

  private async makeRequest<T>(
    url: string,
    options: ApiRequestOptions = {}
  ): Promise<T> {
    const response = await this.request(url, options)

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}))
      throw new Error(
        errorData.error || `HTTP error! status: ${response.status}`
      )
    }

    const contentType = response.headers.get('content-type')
    if (contentType && contentType.includes('application/json')) {
      return await response.json()
    }

    return (await response.text()) as T
  }

  async get<T>(url: string, options?: ApiRequestOptions): Promise<T> {
    return this.makeRequest<T>(url, { ...options, method: 'GET' })
  }

  async post<T>(
    url: string,
    data?: unknown,
    options?: ApiRequestOptions
  ): Promise<T> {
    const isFormData = data instanceof FormData
    return this.makeRequest<T>(url, {
      ...options,
      method: 'POST',
      body: isFormData
        ? (data as BodyInit)
        : data
          ? JSON.stringify(data)
          : undefined,
    })
  }

  async put<T>(
    url: string,
    data?: unknown,
    options?: ApiRequestOptions
  ): Promise<T> {
    const isFormData = data instanceof FormData
    return this.makeRequest<T>(url, {
      ...options,
      method: 'PUT',
      body: isFormData
        ? (data as BodyInit)
        : data
          ? JSON.stringify(data)
          : undefined,
    })
  }

  async delete<T>(url: string, options?: ApiRequestOptions): Promise<T> {
    return this.makeRequest<T>(url, { ...options, method: 'DELETE' })
  }

  async patch<T>(
    url: string,
    data?: unknown,
    options?: ApiRequestOptions
  ): Promise<T> {
    const isFormData = data instanceof FormData
    return this.makeRequest<T>(url, {
      ...options,
      method: 'PATCH',
      body: isFormData
        ? (data as BodyInit)
        : data
          ? JSON.stringify(data)
          : undefined,
    })
  }
}

export const API_BASE_URL = '/api/v1'

// Create a singleton instance
export const apiClient = new ApiClient(API_BASE_URL)
export const authApiClient = new ApiClient('/api')
