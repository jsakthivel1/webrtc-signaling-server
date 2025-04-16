const WebSocket = require('ws');

const PORT = process.env.PORT || 8080;
const wss = new WebSocket.Server({ port: PORT });

// Store connected clients: clientId -> { ws: WebSocketInstance, roomId: string | null, role: string | null }
const clients = new Map();
// Store rooms: roomId -> Set<clientId>
const rooms = new Map();

console.log(`WebSocket Signaling Server (Role Based) started on port ${PORT}`);

wss.on('connection', (ws) => {
    const clientId = generateUniqueId();
    // Store client with null room/role initially
    clients.set(clientId, { ws: ws, roomId: null, role: null });
    console.log(`Client connected: ${clientId}`);

    // Send the client their ID
    ws.send(JSON.stringify({ type: 'your-id', payload: { id: clientId } }));

    ws.on('message', (message) => {
        let parsedMessage;
        try {
            parsedMessage = JSON.parse(message);
            const senderInfo = clients.get(clientId);
            if (!senderInfo) return;

            console.log(
                `Received message from <span class="math-inline">\{clientId\} \(</span>{senderInfo.role || 'No role'}) in Room (${
                    senderInfo.roomId || 'No room'
                }):`,
                parsedMessage.type,
            );

            switch (parsedMessage.type) {
                case 'join-room':
                    // Now expect role in payload
                    handleJoinRoom(
                        clientId,
                        parsedMessage.payload.roomId,
                        parsedMessage.payload.role,
                        ws,
                    );
                    break;

                case 'offer':
                case 'answer':
                case 'ice-candidate':
                case 'hangup': // Handle hangup relay
                    relayToPeer(clientId, senderInfo.roomId, parsedMessage);
                    break;

                default:
                    console.warn(
                        `Unknown message type from ${clientId}:`,
                        parsedMessage.type,
                    );
            }
        } catch (error) {
            console.error(
                `Failed to parse or handle message from ${clientId}:`,
                message,
                error,
            );
        }
    });

    ws.on('close', () => {
        handleDisconnect(clientId);
    });

    ws.on('error', (error) => {
        console.error(`WebSocket error for client ${clientId}:`, error);
        handleDisconnect(clientId);
    });
});

// Modified to accept and store role
function handleJoinRoom(clientId, roomId, role, ws) {
    const clientInfo = clients.get(clientId);
    // Allow re-joining the same room (e.g., on refresh), but prevent joining a different room
    if (!clientInfo || (clientInfo.roomId && clientInfo.roomId !== roomId)) {
        console.warn(
            `Client ${clientId} is already in room ${clientInfo?.roomId} or info missing. Cannot join ${roomId}.`,
        );
        ws.send(
            JSON.stringify({
                type: 'error',
                payload: {
                    message: `You are already associated with room ${clientInfo?.roomId}.`,
                },
            }),
        );
        return;
    }

    // Get or create the room
    let room = rooms.get(roomId);
    if (!room) {
        room = new Set();
        rooms.set(roomId, room);
        console.log(`Room created: ${roomId}`);
    }

    // Check if room is full (allow re-joining for the same client)
    if (room.size >= 2 && !room.has(clientId)) {
        console.warn(`Room ${roomId} is full. Client ${clientId} cannot join.`);
        ws.send(
            JSON.stringify({
                type: 'error',
                payload: {
                    message: `Interview room ${roomId} is currently full.`,
                },
            }),
        );
        return;
    }

    // Join the room (add client ID to room set)
    room.add(clientId);
    // Update client info with room and role
    clientInfo.roomId = roomId;
    clientInfo.role = role || 'unknown'; // Store the role
    console.log(
        `Client <span class="math-inline">\{clientId\} \(</span>{clientInfo.role}) joined room ${roomId}. Room size: ${room.size}`,
    );

    // Notify others in the room
    const otherClientIds = [...room].filter((id) => id !== clientId);
    if (otherClientIds.length > 0) {
        const peerId = otherClientIds[0];
        const peerClientInfo = clients.get(peerId);
        if (peerClientInfo) {
            console.log(
                `Notifying peer <span class="math-inline">\{peerId\} \(</span>{peerClientInfo.role}) that <span class="math-inline">\{clientId\} \(</span>{clientInfo.role}) joined.`,
            );
            // Notify the existing peer about the new joiner (include role)
            peerClientInfo.ws.send(
                JSON.stringify({
                    type: 'peer-joined',
                    payload: { peerId: clientId, peerRole: clientInfo.role },
                }),
            );
            // Notify the new joiner about the existing peer (include role)
            ws.send(
                JSON.stringify({
                    type: 'peer-joined',
                    payload: { peerId: peerId, peerRole: peerClientInfo.role },
                }),
            );
        }
    } else {
        console.log(
            `Client <span class="math-inline">\{clientId\} \(</span>{clientInfo.role}) is the first in room ${roomId}.`,
        );
        ws.send(JSON.stringify({ type: 'waiting-for-peer' }));
    }
}

function relayToPeer(senderId, roomId, message) {
    // (Keep relayToPeer function the same as previous version)
    if (!roomId) {
        console.warn(
            `Cannot relay message for client ${senderId}, not in a room.`,
        );
        return;
    }
    const room = rooms.get(roomId);
    if (!room) {
        console.warn(
            `Room ${roomId} not found for relaying message from ${senderId}.`,
        );
        return;
    }

    room.forEach((clientId) => {
        if (clientId !== senderId) {
            const clientInfo = clients.get(clientId);
            if (clientInfo && clientInfo.ws.readyState === WebSocket.OPEN) {
                const messageToSend = { ...message, sender: senderId };
                console.log(
                    `Relaying message type ${message.type} from ${senderId} to ${clientId} in room ${roomId}`,
                );
                clientInfo.ws.send(JSON.stringify(messageToSend));
            }
        }
    });
}

function handleDisconnect(clientId) {
    // (Keep handleDisconnect function the same as previous version)
    const clientInfo = clients.get(clientId);
    if (!clientInfo) return;

    console.log(
        `Client disconnected: <span class="math-inline">\{clientId\} \(</span>{clientInfo.role})`,
    );
    const roomId = clientInfo.roomId;

    clients.delete(clientId);

    if (roomId) {
        const room = rooms.get(roomId);
        if (room) {
            room.delete(clientId);
            console.log(
                `Client ${clientId} removed from room ${roomId}. Room size: ${room.size}`,
            );

            if (room.size > 0) {
                const remainingClientId = [...room][0];
                const remainingClientInfo = clients.get(remainingClientId);
                if (
                    remainingClientInfo &&
                    remainingClientInfo.ws.readyState === WebSocket.OPEN
                ) {
                    console.log(
                        `Notifying peer ${remainingClientId} that ${clientId} left.`,
                    );
                    remainingClientInfo.ws.send(
                        JSON.stringify({
                            type: 'peer-left',
                            payload: { peerId: clientId },
                        }),
                    );
                }
            } else {
                rooms.delete(roomId);
                console.log(`Room ${roomId} is now empty and deleted.`);
            }
        }
    }
}

function generateUniqueId() {
    return Math.random().toString(36).substring(2, 10);
}

wss.on('error', (error) => {
    console.error('WebSocket Server Error:', error);
});
