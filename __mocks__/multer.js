// multer mock
function multer(options) {
  return {
    single: (fieldName) => (req, res, next) => next(), 
    array: (fieldName) => (req, res, next) => next(),
    fields: (fields) => (req, res, next) => next(),
    storage: options?.storage,
    fileFilter: options?.fileFilter,
  };
}


multer.diskStorage = (opts) => ({ ...opts });

export default multer;
