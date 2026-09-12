import { Router, type Request, type Response } from "express";
import { prisma } from "../lib/prisma.js";

const productRouter = Router();


productRouter.post("/", async (req, res) => {
  try {
    const productData = req.body;

    const data = await prisma.product.create({
      data: productData,
    });

    res.status(200).json({
      success: true,
      message: "Product created successfully",
      data: data,
    });
  } catch (error) {
    console.log("Error message:", error);
    res.status(500).json({
      success: false,
      message: "Error creating product",
    });
  }
});



productRouter.get("/",async(req:Request,res:Response)=>{
    try{
        const products = await prisma.product.findMany();
        res.status(200).json({
            successful: true,
            message:"successfuly product data post",
            data:products
        })
    }
    catch(error){
      res.status(500).json({successfull:false,
        message:"somthin wrong"
      })
    }
})

export default productRouter;