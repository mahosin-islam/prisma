import express from "express";

import cors from "cors"
const app = express();


//midelware
app.use(cors());
app.use(express.json());

app.get("/", (req, res) => {
    res.json({
        success: true,
        message: "wellcome to my api"
    })
})

app.get("/user",(req,res)=>{
    res.send("user routers")
})
export default app;