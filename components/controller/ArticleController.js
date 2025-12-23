import Article from "../module/ArticleModel.js";
import { calculateReadTime } from "../../utils/readTime.js";


  //  1. ADD ARTICLE

export const createArticle = async (req, res) => {
  try {
    const { title, content, author, category, status } = req.body;

    const readTime = calculateReadTime(content);

    const article = await Article.create({
      title,
      content,
      author,
      category,
      status,
      readTime,
      image: imagePath,
      Views,
    });

    res.status(201).json({
      success: true,
      data: article,
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};


  //  2. GET ALL ARTICLES
  
export const getAllArticles = async (req, res) => {
  try {
    const { page = 1, limit = 10, category, status } = req.query;

    const filter = {};
    if (category) filter.category = category;
    if (status) filter.status = status;

    const articles = await Article.find(filter)
      .select("title author category status readTime createdAt")
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(Number(limit));

    const total = await Article.countDocuments(filter);

    res.json({
      success: true,
      total,
      page: Number(page),
      data: articles,
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};


  //  3. GET SINGLE ARTICLE

export const getArticleById = async (req, res) => {
  try {
    const article = await Article.findById(req.params.id);

    if (!article) {
      return res.status(404).json({ message: "Article not found" });
    }

    res.json({ success: true, data: article });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};


  //  4. UPDATE ARTICLE
export const updateArticle = async (req, res) => {
  try {
    const updatedData = { ...req.body };

    if (req.body.content) {
      updatedData.readTime = calculateReadTime(req.body.content);
    }

    if (req.file) {
      updatedData.image = `/uploads/articles/${req.file.filename}`;
    }

    const article = await Article.findByIdAndUpdate(
      req.params.id,
      updatedData,
      { new: true }
    );

    res.json({ success: true, data: article });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

  //  5. DELETE ARTICLE

export const deleteArticle = async (req, res) => {
  try {
    const article = await Article.findByIdAndDelete(req.params.id);

    if (!article) {
      return res.status(404).json({ message: "Article not found" });
    }

    res.json({ success: true, message: "Article deleted successfully" });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};


  //  6. CHANGE STATUS

export const changeArticleStatus = async (req, res) => {
  try {
    const { status } = req.body;

    if (!["Draft", "Published"].includes(status)) {
      return res.status(400).json({ message: "Invalid status" });
    }

    const article = await Article.findByIdAndUpdate(
      req.params.id,
      { status },
      { new: true }
    );

    res.json({ success: true, data: article });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};


  //  7. GET BY CATEGORY

export const getArticlesByCategory = async (req, res) => {
  try {
    const articles = await Article.find({
      category: req.params.category,
      status: "Published",
    });

    res.json({ success: true, data: articles });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};
