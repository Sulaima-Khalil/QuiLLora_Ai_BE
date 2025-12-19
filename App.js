import express from "express";
import cors from "cors";
import UserRouter from "./components/router/UserRouter.js";
import { errorHandler } from "./components/middleware/ErrorMiddleware.js";

const app = express();

// Middleware
app.use(cors({
  origin: process.env.FRONTEND_URL, 
  credentials: true,
}));
app.use(express.json()); 

// Routes
app.use("/api/auth", UserRouter);


app.use(errorHandler);


app.use((req, res, next) => {
  res.status(404).json({ success: false, message: "Route not found" });
});

export default app;
