import express from "express";
import {
  createArticle,
  getAllArticles,
  getArticleById,
  updateArticle,
  deleteArticle,
  changeArticleStatus,
  getArticlesByCategory,
} from "../controller/ArticleController.js";
import { uploadArticleImage } from '../middleware/upload.js'
const articleRouter = express.Router();

articleRouter.post("/create", createArticle);
articleRouter.get("/", getAllArticles);
articleRouter.post("/", uploadArticleImage.single("image"), createArticle);
articleRouter.put("/:id", uploadArticleImage.single("image"), updateArticle);
articleRouter.get("/:id", getArticleById);
articleRouter.put("/:id", updateArticle);
articleRouter.delete("/:id", deleteArticle);
articleRouter.patch("/:id/status", changeArticleStatus);
articleRouter.get("/category/:category", getArticlesByCategory);

export default articleRouter;
