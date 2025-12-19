import express from "express";
import {
  registerUser,
  loginUser,
  logoutUser
} from "../controller/UserController.js";
import { protect } from "../middleware/AuthMiddleware.js";

const router = express.Router();

router.post("/register", registerUser);
router.post("/login", loginUser);
router.post("/logout", protect, logoutUser);

export default router;
