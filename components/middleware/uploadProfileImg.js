import multer from "multer";
import path from "path";

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, "uploads/profiles"),
  filename: (req, file, cb) => {
    cb(null, `${Date.now()}-${file.fieldname}${path.extname(file.originalname)}`);
  }
});

export const uploadProfileImage = multer({
  storage,
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith("image/")) cb(null, true);
    else cb(new Error("Only image files allowed"), false);
  }
});
