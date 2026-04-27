import { useMemo, useState } from 'react'
import {
  IconArrowUp,
  IconDownload,
  IconEye,
  IconFile,
  IconFolder,
  IconHome,
  IconLoader,
  IconRefresh,
  IconUpload,
} from '@tabler/icons-react'
import { Container } from 'kubernetes-types/core/v1'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import {
  podDownloadFile,
  podPreviewFile,
  podUploadFile,
  usePodFiles,
} from '@/lib/api'
import { toSimpleContainer } from '@/lib/k8s'
import { translateError } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { ScrollArea } from '@/components/ui/scroll-area'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'

import { ErrorMessage } from './error-message'
import { ContainerSelector } from './selector/container-selector'

interface PodFileBrowserProps {
  namespace: string
  podName: string
  containers?: Container[]
  initContainers?: Container[]
}

export function PodFileBrowser({
  namespace,
  podName,
  containers: _containers = [],
  initContainers = [],
}: PodFileBrowserProps) {
  const containers = useMemo(() => {
    return toSimpleContainer(initContainers, _containers)
  }, [_containers, initContainers])

  const [selectedContainer, setSelectedContainer] = useState<string>(
    containers[0]?.name || ''
  )
  const [currentPath, setCurrentPath] = useState<string>('/')
  const [isUploading, setIsUploading] = useState(false)
  const { t } = useTranslation()

  const {
    data: files,
    isLoading,
    refetch,
    error,
  } = usePodFiles(namespace, podName, selectedContainer, currentPath)

  const handleNavigate = (path: string) => {
    if (!path.startsWith('/')) {
      path = '/' + path
    }
    setCurrentPath(path)
  }

  const handleEnterDirectory = (dirName: string) => {
    const newPath =
      currentPath === '/' ? `/${dirName}` : `${currentPath}/${dirName}`
    handleNavigate(newPath)
  }

  const handleGoUp = () => {
    if (currentPath === '/') return
    const parts = currentPath.split('/')
    parts.pop()
    const newPath = parts.join('/') || '/'
    handleNavigate(newPath)
  }

  const handleDownload = (fileName: string) => {
    const filePath =
      currentPath === '/' ? `/${fileName}` : `${currentPath}/${fileName}`
    podDownloadFile(namespace, podName, selectedContainer, filePath)
  }

  const handlePreview = (fileName: string) => {
    const filePath =
      currentPath === '/' ? `/${fileName}` : `${currentPath}/${fileName}`
    podPreviewFile(namespace, podName, selectedContainer, filePath)
  }

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    setIsUploading(true)
    try {
      await podUploadFile(
        namespace,
        podName,
        selectedContainer,
        currentPath,
        file
      )
      refetch()
      toast.success(`Uploaded ${file.name} successfully`)
    } catch (error) {
      toast.error(translateError(error, t))
    } finally {
      setIsUploading(false)
      e.target.value = ''
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-4">
        <ContainerSelector
          containers={containers}
          selectedContainer={selectedContainer}
          showAllOption={false}
          onContainerChange={(value) => setSelectedContainer(value!)}
        />
        <div className="flex-1 flex items-center gap-2">
          <Button
            variant="outline"
            size="icon"
            aria-label="Go to parent directory"
            onClick={handleGoUp}
            disabled={currentPath === '/'}
          >
            <IconArrowUp className="w-4 h-4" />
          </Button>
          <Button
            variant="outline"
            size="icon"
            aria-label="Go to home directory"
            onClick={() => handleNavigate('/')}
            disabled={currentPath === '/'}
          >
            <IconHome className="w-4 h-4" />
          </Button>
          <Input
            value={currentPath}
            aria-label="Current path"
            onChange={(e) => setCurrentPath(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                handleNavigate(currentPath)
              }
            }}
            className="font-mono"
          />
          <Button
            aria-label="Refresh file list"
            variant="outline"
            size="icon"
            onClick={() => refetch()}
          >
            <IconRefresh className="w-4 h-4" />
          </Button>
        </div>
        <div>
          <Input
            type="file"
            id="file-upload"
            className="hidden"
            onChange={handleUpload}
            disabled={isUploading}
          />
          <Label
            htmlFor="file-upload"
            className={`inline-flex items-center justify-center whitespace-nowrap rounded-md text-sm font-medium ring-offset-background transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 bg-primary text-primary-foreground hover:bg-primary/90 h-10 px-4 py-2 cursor-pointer ${
              isUploading ? 'opacity-50 cursor-not-allowed' : ''
            }`}
          >
            {isUploading ? (
              <IconLoader className="w-4 h-4 animate-spin mr-2" />
            ) : (
              <IconUpload className="w-4 h-4 mr-2" />
            )}
            Upload
          </Label>
        </div>
      </div>

      {error ? (
        <ErrorMessage
          resourceName={'pod files'}
          error={error}
          refetch={refetch}
        />
      ) : (
        <ScrollArea className="border rounded-md min-w-full max-h-[calc(100dvh-250px)]">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-[50px]"></TableHead>
                <TableHead>Name</TableHead>
                <TableHead className="w-[100px]">UID</TableHead>
                <TableHead className="w-[100px]">GID</TableHead>
                <TableHead className="w-[100px]">Size</TableHead>
                <TableHead className="w-[150px]">Mode</TableHead>
                <TableHead className="w-[200px]">Modified</TableHead>
                <TableHead className="w-[120px]">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow>
                  <TableCell colSpan={8} className="h-24 text-center">
                    <div className="flex items-center justify-center gap-2">
                      <IconLoader className="animate-spin" />
                      <span>Loading files...</span>
                    </div>
                  </TableCell>
                </TableRow>
              ) : (files ?? []).length === 0 ? (
                <TableRow>
                  <TableCell colSpan={8} className="h-24 text-center">
                    No files found
                  </TableCell>
                </TableRow>
              ) : (
                files &&
                files.map((file) => (
                  <TableRow key={file.name}>
                    <TableCell>
                      {file.isDir ? (
                        <IconFolder className="w-4 h-4 text-blue-500" />
                      ) : (
                        <IconFile className="w-4 h-4 text-gray-500" />
                      )}
                    </TableCell>
                    <TableCell>
                      {file.isDir ? (
                        <Button
                          variant="link"
                          className="text-foreground font-medium hover:underline text-left p-0 h-auto"
                          onClick={() => handleEnterDirectory(file.name)}
                          aria-label={`Enter directory ${file.name}`}
                        >
                          {file.name}
                        </Button>
                      ) : (
                        <span>{file.name}</span>
                      )}
                    </TableCell>
                    <TableCell className="font-mono text-xs">
                      {file.uid}
                    </TableCell>
                    <TableCell className="font-mono text-xs">
                      {file.gid}
                    </TableCell>
                    <TableCell className="font-mono text-xs">
                      {file.size}
                    </TableCell>
                    <TableCell className="font-mono text-xs">
                      {file.mode}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {file.modTime}
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-1">
                        {!file.isDir && (
                          <Button
                            variant="ghost"
                            size="sm"
                            title="Preview file"
                            aria-label="Preview file"
                            onClick={() => handlePreview(file.name)}
                          >
                            <IconEye className="w-4 h-4" />
                          </Button>
                        )}
                        <Button
                          variant="ghost"
                          size="sm"
                          title={
                            file.isDir
                              ? 'Download directory as .tar archive'
                              : 'Download file'
                          }
                          aria-label={
                            file.isDir
                              ? 'Download directory as .tar archive'
                              : 'Download file'
                          }
                          onClick={() => handleDownload(file.name)}
                        >
                          <IconDownload className="w-4 h-4" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </ScrollArea>
      )}
    </div>
  )
}
