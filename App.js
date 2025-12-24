import express from "express";
import cors from "cors";
import UserRouter from "./components/router/UserRouter.js";
import articleRouter from "./components/router/ArticleRouter.js";
import ProfileRouter from "./components/router/ProfileRouter.js";
import { errorHandler } from "./components/middleware/ErrorMiddleware.js";

const app = express();

app.use(cors({
  origin: "http://localhost:5173",
  credentials: true,
}));

app.use(express.json());

app.use("/api/auth", UserRouter);
app.use("/api/articles", articleRouter);
app.use("/api/profile", ProfileRouter);

app.use(errorHandler);

app.use((req, res) => {
  res.status(404).json({ success: false, message: "Route not found" });
});

export default app;
