import bodyParser from "body-parser";
import express from "express";
import { BASE_NODE_PORT } from "../config";
import { NodeState, Value } from "../types";
import axios from 'axios'; // Importing axios for making HTTP requests
import * as console from "console";
import { delay } from "../utils"; // Importing delay function for asynchronous delay

export function node(
    nodeId: number,
    N: number,
    F: number,
    initialValue: Value,
    isFaulty: boolean,
    nodesAreReady: () => boolean,
    setNodeIsReady: (index: number) => void
) {
    const node = express();
    node.use(express.json());
    node.use(bodyParser.json());

    let nodeState: NodeState = {
        killed: false,
        x: null,
        decided: null,
        k: null
    };

    let messagesR: Map<number, any[]> = new Map();
    let messagesP: Map<number, any[]> = new Map();

    node.get("/status", (req, res) => {
        res.status(isFaulty ? 500 : 200).send(isFaulty ? "faulty" : "live");
    });

    node.post("/message", (req, res) => {
        const { k, x, messageType } = req.body;
        if (!isFaulty && !nodeState.killed) {
            if (messageType === "R") {
                handleRequestMessage(k, x);
            } else if (messageType === "P") {
                handleProposalMessage(k, x);
            }
        }
        res.status(200).send("message received");
    });

    function handleRequestMessage(k: number, x: Value) {
        if (!messagesR.has(k)) {
            messagesR.set(k, []);
        }
        messagesR.get(k)!.push(x);
        const messageR = messagesR.get(k)!;
        if (messageR.length >= (N - F)) {
            const { countZero, countOne } = countOccurrences(messageR);
            const newX = determineNewValue(countZero, countOne);
            sendProposalMessages(k, newX);
        }
    }

    function handleProposalMessage(k: number, x: Value) {
        if (!messagesP.has(k)) {
            messagesP.set(k, []);
        }
        messagesP.get(k)!.push(x);
        const messageP = messagesP.get(k)!;
        if (messageP.length >= N - F) {
            const { countZero, countOne } = countOccurrences(messageP);
            if (countZero >= F + 1) {
                nodeState.x = 0;
                nodeState.decided = true;
            } else if (countOne >= F + 1) {
                nodeState.x = 1;
                nodeState.decided = true;
            } else {
                nodeState.x = determineNewValue(countZero, countOne);
                nodeState.k = k + 1;
                sendRequestMessages(nodeState.k, nodeState.x);
            }
        }
    }

    function countOccurrences(message: Value[]): { countZero: number; countOne: number } {
        const countZero = message.filter(el => el === 0).length;
        const countOne = message.filter(el => el === 1).length;
        return { countZero, countOne };
    }

    function determineNewValue(countZero: number, countOne: number): Value {
        let newX: Value = "?";
        if (countZero > (N / 2)) {
            newX = 0;
        } else if (countOne > (N / 2)) {
            newX = 1;
        }
        return newX;
    }

    function sendProposalMessages(k: number, newX: Value) {
        for (let i = 0; i < N; i++) {
            sendMessage(i, k, newX, "P");
        }
    }

    function sendRequestMessages(k: number, newX: Value) {
        for (let i = 0; i < N; i++) {
            sendMessage(i, k, newX, "R");
        }
    }

    function sendMessage(destId: number, k: number, x: Value, messageType: string) {
        try {
            axios.post(`http://localhost:${BASE_NODE_PORT + destId}/message`, { k, x, messageType });
        } catch (error) {
            console.error(`Error sending message to node ${destId}: ${(error as Error).message}`);
        }
    }

    node.get("/start", (req, res) => {
        while (!nodesAreReady()) {
            delay(5);
        }

        if (!isFaulty) {
            nodeState.decided = false;
            nodeState.x = initialValue;
            nodeState.k = 1;
            sendRequestMessages(nodeState.k, nodeState.x);
        } else {
            nodeState.decided = null;
            nodeState.x = null;
            nodeState.k = null;
        }
        res.status(200).send("started");
    });

    node.get("/stop", (req, res) => {
        nodeState.killed = true;
        res.status(200).send("killed");
    });

    node.get("/getState", (req, res) => {
        res.status(200).send({ x: nodeState.x, k: nodeState.k, killed: nodeState.killed, decided: nodeState.decided });
    });

    const server = node.listen(BASE_NODE_PORT + nodeId, () => {
        console.log(`Node ${nodeId} is listening on port ${BASE_NODE_PORT + nodeId}`);
        setNodeIsReady(nodeId);
    });

    return server;
}
