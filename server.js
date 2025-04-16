const WebSocket = require('ws');

// Use the port Azure App Service provides, or 8080 for local testing
const PORT = process.env.PORT || 8080;

const wss = new WebSocket.Server({ port: PORT });

// Store connected clients { clientId: wsInstance }
const clients = new Map();

console.log(`WebSocket Signaling Server started on port ${PORT}`);

wss.on('connection', (ws) => {
    // Generate a unique ID for this client
    const clientId = generateUniqueId();
    clients.set(clientId, ws);
    console.log(`Client connected: ${clientId}`);

    // Send the client their ID
    ws.send(JSON.stringify({ type: 'your-id', payload: { id: clientId } }));

    ws.on('message', (message) => {
        let parsedMessage;
        try {
            parsedMessage = JSON.parse(message);
            console.log(
                `Received message from ${clientId}:`,
                parsedMessage.type,
            );

            const targetClientId = parsedMessage.target;
            const targetWs = clients.get(targetClientId);

            if (targetWs && targetWs.readyState === WebSocket.OPEN) {
                // Add sender info and relay the message
                const messageToSend = {
                    ...parsedMessage,
                    sender: clientId, // Let receiver know who sent it
                    target: undefined, // No need to send target back
                };
                console.log(
                    `Relaying message type ${messageToSend.type} from ${clientId} to ${targetClientId}`,
                );
                targetWs.send(JSON.stringify(messageToSend));
            } else {
                console.warn(
                    `Target client ${targetClientId} not found or not open.`,
                );
                // Optional: Send an error back to the sender
                ws.send(
                    JSON.stringify({
                        type: 'error',
                        payload: {
                            message: `User ${targetClientId} not found or offline.`,
                        },
                    }),
                );
            }
        } catch (error) {
            console.error(
                `Failed to parse message or invalid message format from ${clientId}:`,
                message,
                error,
            );
        }
    });

    ws.on('close', () => {
        console.log(`Client disconnected: ${clientId}`);
        clients.delete(clientId);
        // Optional: Notify other clients if needed (e.g., for presence)
    });

    ws.on('error', (error) => {
        console.error(`WebSocket error for client ${clientId}:`, error);
        clients.delete(clientId); // Clean up on error
    });
});

function generateUniqueId() {
    // Simple unique ID generator (replace with more robust method if needed)
    return Math.random().toString(36).substring(2, 10);
}

// Handle server errors
wss.on('error', (error) => {
    console.error('WebSocket Server Error:', error);
});
