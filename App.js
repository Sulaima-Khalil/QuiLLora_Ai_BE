import express from "express";
import cors from "cors";
import UserRouter from "./components/router/UserRouter.js";
import { errorHandler } from "./components/middleware/ErrorMiddleware.js";
import articleRouter from "./components/router/ArticleRouter.js";
import ProfileRouter from "./components/router/ProfileRouter"
const app = express();

// Middleware
app.use(cors({
  origin: "http://localhost:5173", 
  credentials: true,
}));
app.use(express.json()); 

// Routes
app.use("/api/auth", UserRouter);
app.use("/api/articles", articleRouter);
app.use("/api/profile", ProfileRouter)
app.use(errorHandler);


app.use((req, res, next) => {
  res.status(404).json({ success: false, message: "Route not found" });
});

export default app;
