import { Router } from "express";
import { prisma } from "../lib/prisma.js";

const userRouter = Router();

// ১. Create User (POST)
userRouter.post("/", async (req, res) => {
  try {
    const userData = req.body;
    const result = await prisma.user.create({
      data: userData,
    });
    res.status(201).json({
      success: true,
      message: "User created successfully",
      data: result,
    });
  } catch (error) {
    res.status(500).json({ success: false, message: "Error creating user" });
  }
});




// ২. Get All Users (GET)
userRouter.get("/", async (req, res) => {
  try {
    const users = await prisma.user.findMany();
    res.status(200).json({
      success: true,
      message: "Users fetched successfully",
      data: users,
    });
  } catch (error) {
    res.status(500).json({ success: false, message: "Error fetching users" });
  }
});

// ৩. Get Single User (GET)
userRouter.get("/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const user = await prisma.user.findUnique({
      where: { id: String(id) }, // id যদি UUID (String) হয়, তবে শুধু id দিন
    });

    if (!user) {
      res.status(404).json({ success: false, message: "User not found" });
      return;
    }

    res.status(200).json({
      success: true,
      message: "User fetched successfully",
      data: user,
    });
  } catch (error) {
    res.status(500).json({ success: false, message: "Error fetching user" });
  }
});

// ৪. Update User (PUT / PATCH)
userRouter.put("/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const updateData = req.body;

    const result = await prisma.user.update({
      where: { id: String(id) },
      data: updateData,
    });

    res.status(200).json({
      success: true,
      message: "User updated successfully",
      data: result,
    });
  } catch (error) {
    res.status(500).json({ success: false, message: "Error updating user" });
  }
});

// ৫. Delete User (DELETE)
userRouter.delete("/:id", async (req, res) => {
  try {
    const { id } = req.params;

    await prisma.user.delete({
      where: { id: String(id) },
    });

    res.status(200).json({
      success: true,
      message: "User deleted successfully",
    });
  } catch (error) {
    res.status(500).json({ success: false, message: "Error deleting user" });
  }
});

export default userRouter;