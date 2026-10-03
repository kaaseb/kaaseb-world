// ONE file-picker filter for every project upload. The pickers used to carry
// per-bucket lists (specs: PDF/Word only, BOQ: no ZIP, no .xlsm…), so the OS
// dialog simply did not SHOW the client's file — to the team that looked like
// "the system refuses it". What a file is gets decided from its content after
// upload (lib/files/sniff); the picker's only job is not to hide anything a
// client might send.

export const PROJECT_FILE_ACCEPT = [
  // spreadsheets
  '.xlsx', '.xlsm', '.xlsb', '.xls', '.ods', '.csv', '.tsv',
  // documents
  '.pdf', '.docx', '.doc', '.rtf', '.txt', '.pptx', '.ppt',
  // images / scans
  '.png', '.jpg', '.jpeg', '.webp', '.gif', '.bmp', '.tif', '.tiff', '.heic',
  // drawings
  '.dwg', '.dxf',
  // archives & mail
  '.zip', '.rar', '.7z', '.msg', '.eml',
].join(',')
