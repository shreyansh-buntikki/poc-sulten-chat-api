import { Request, Response } from "express";

export class LangchainController {
    static async chat(req: Request, res: Response) {
        try {
            const { username } = req.params;
            const { message } = req.body;
            
            
        } catch (error) {
            console.error("Error in chat:", error);
            res.status(500).json({ message: "Internal server error", error });
        }
    }
}