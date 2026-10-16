'use strict';
   
                                                                         
                                                                       
                                                                      
                                                                  
                                                                  
                                                                           
  
                                                                        
                                                                         
                                                                       
                                                                      
   
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('akhtarFS', {
  getRoot: () => ipcRenderer.invoke('osfs:getRoot'),
  list: (path) => ipcRenderer.invoke('osfs:list', path),
  readFile: (path) => ipcRenderer.invoke('osfs:readFile', path),
  writeFile: (path, content) => ipcRenderer.invoke('osfs:writeFile', path, content),
  writeBinary: (path, base64) => ipcRenderer.invoke('osfs:writeBinary', path, base64),
  mkdir: (path) => ipcRenderer.invoke('osfs:mkdir', path),
  delete: (path) => ipcRenderer.invoke('osfs:delete', path),
  exists: (path) => ipcRenderer.invoke('osfs:exists', path),
  migrate: (fileSystemTree) => ipcRenderer.invoke('osfs:migrate', fileSystemTree),
  openRootFolder: () => ipcRenderer.invoke('osfs:openRootFolder'),
});
