import express from "express";
import { getUserProfile, editUserProfile, toggleFollow } from "../controller/ProfileController.js";
import { auth } from "../middleware/AuthMiddleware.js";
import { uploadProfileImage } from "../middleware/uploadProfileImg.js";

const profileRouter = express.Router();

profileRouter.get("/:id", getUserProfile); 
profileRouter.put("/edit", auth, uploadProfileImage.single("profileImage"), editUserProfile); 
profileRouter.post("/follow/:id", auth, toggleFollow); 

export default profileRouter;
