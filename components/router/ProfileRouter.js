import express from "express";
import { getUserProfile, editUserProfile, toggleFollow } from "../controller/ProfileController.js";
import  { protect }  from "../middleware/AuthMiddleware.js";
import { uploadProfileImage } from "../middleware/uploadProfileImg.js";

const profileRouter = express.Router();

profileRouter.get("/:id", getUserProfile); 
profileRouter.put("/edit", protect, uploadProfileImage.single("profileImage"), editUserProfile); 
profileRouter.post("/follow/:id", protect, toggleFollow); 

export default profileRouter;
