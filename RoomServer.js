const express = require("express");
const http = require("http");
const cors = require("cors")
const app = express();
const server = http.createServer(app);
const socket = require("socket.io");
const io = socket(server, {
    cors: {
        origin: "*", // Replace with your client URL
        methods: ["GET", "POST"],
    },
}
);

let users = {};
const socketToRoom = {};
let onlineUsers = [];
let disconnectUser;
app.use(cors())
io.on('connection', socket => {
    socket.on("join", (data) => {
        const { user } = data;
        if (user.id && !onlineUsers.some((us) => us.userId === user.id)) {
            onlineUsers.push({ userId: user.id, socketId: socket.id });
        }

        if (disconnectUser) {
            onlineUsers = onlineUsers.map(user => {
                if (user.userId === disconnectUser) {
                    disconnectUser = undefined
                    return ({ ...user, socketId: socket.id, })
                }
                return ({ ...user, socketId: user.socketId, })
            });
        }
        // Broadcast the updated online users list
        io.emit("onlineUsers", onlineUsers);
    })
    socket.on("join room", roomID => {
        const joiner = onlineUsers.find((us) => us.userId === roomID?.from);
        if (users[roomID?.roomID]) {
            users[roomID?.roomID].push(joiner);
            users[roomID?.roomID] = [...new Set(users[roomID?.roomID])]

        } else {
            users[roomID?.roomID] = [joiner];
        }
        socketToRoom[socket.id] = roomID?.roomID;
        const usersInThisRoom = users[roomID?.roomID].filter(id => id.socketId !== socket.id);


        socket.emit("all users",
            {
                users: usersInThisRoom,
                isVideo: roomID?.isVideo,
                from: roomID?.from,
                name: roomID?.name,
            }
        );
    });
    socket.on("callUser", ({ roomID, userId, from, name, isVideo }) => {


        if (!onlineUsers.some((us) => us.userId === from)) {
            onlineUsers.push({ userId: from, socketId: socket.id });
        }
        const caller = onlineUsers.find((us) => us.userId === from);
        if (!onlineUsers.some((us) => us.userId === userId)) {
            console.log(onlineUsers, "offline");

            io.to(caller.socketId).emit("offilne");
            return
        }
        const answerer = onlineUsers.find((us) => us.userId === userId);
        users["undefined"] = undefined;

        const checking = isUserAvailable(users, answerer?.socketId)
        console.log(checking)

        if (checking.available) {
            console.log("isAvailable")
            io.to(caller.socketId).emit("user busy");
            return
        }
        if (users[roomID]) {
            users[roomID].push(answerer)
            users[roomID] = [...new Set(users[roomID])]
        } else {
            users[roomID] = [caller];
            users[roomID].push(answerer);
        }
        socketToRoom[socket.id] = roomID;

        io.to(answerer.socketId).emit("callUser", { roomID, from, name, socketId: caller, isVideo });
    });
    socket.on("invite", ({ roomID, userId, from, name, isVideo }) => {
        const inviter = onlineUsers.find((us) => us.userId === userId);
        const caller = onlineUsers.find((us) => us.userId === from);
        if (!inviter?.socketId) {
            io.to(caller.socketId).emit("offilne");
            return
        }
        users["undefined"] = undefined
        const checking = isUserAvailable(users, inviter?.socketId)
        console.log(checking)

        if (checking.available) {
            console.log("isAvailable")
            io.to(caller.socketId).emit("user busy");
            return
        }
        users[roomID]?.push(inviter);
        users[roomID?.roomID] = [...new Set(users[roomID])]
        io.to(inviter.socketId).emit("callUser", { roomID, from, name, caller: inviter, isVideo });
    });

    socket.on("sending signal", payload => {
        const caller = onlineUsers.find((us) => us.socketId === payload.callerID);
        io.to(payload.userToSignal.socketId).emit('user joined', { signal: payload.signal, callerID: caller, isVideo: payload.isVideo });
    });
    socket.on("user-leave", payload => {
        const leaveUser = onlineUsers?.find((us) => us.userId === payload.userId);
        if (users[payload?.roomID]) {
            if (leaveUser?.socketId && users[payload?.roomID]?.some(roomiId => roomiId.socketId === leaveUser.socketId)) {
                users[payload?.roomID] = [...users[payload?.roomID]?.filter(id => id.socketId !== leaveUser.socketId)];
                users[payload?.roomID]?.forEach(id => {
                    io.to(id.socketId).emit('user leave', { name: payload?.name, socketId: leaveUser.socketId });
                });
                io.to(leaveUser.socketId).emit("end-room", onlineUsers?.map(({ userId }) => ({ userId })));
            }
            if (users[payload?.roomID]?.length === 1) {
                users[payload?.roomID] = undefined
            }
        } else {
            console.log("No Room")
        }
    });
    socket.on("leave room", payload => {
        socketToRoom[socket.id] = null;
    })
    socket.on("off-camera", payload => {
        users[payload?.roomID]?.forEach(id => {
            io.to(id.socketId).emit('user-off-camera', { user: payload?.user, isHidCamera: payload.isHidCamera });
        });

    })

    socket.on("returning signal", payload => {
        io.to(payload.callerID.socketId).emit('receiving returned signal', { signal: payload.signal, id: socket.id });
    });

    socket.on('disconnect', () => {
        const disconnectedUser = onlineUsers.find(user => user.socketId === socket.id);
        if (disconnectedUser) {
            onlineUsers = onlineUsers.filter(user => user.socketId !== socket.id);
        }
        Object.keys(users).forEach(roomID => {
            users[roomID] = users[roomID]?.filter(id => id !== socket.id);
            users[roomID]?.forEach(id => {
                io.to(id.socketId).emit('user-disconnect', { socketId: socket.id });
            });

            if (users[roomID]?.length === 1) {
                delete users[roomID];
            }
        });
        delete socketToRoom[socket.id];
        io.emit("onlineUsers", onlineUsers); // Broadcast updated onlineUsers list
    })

});
function isUserAvailable(data, targetUserId) {
    // Loop through each room in the object
    for (const room in data) {
        // Check if the room has an array of users
        const users = data[room];
        if (Array.isArray(users)) {
            // Look for the userId in the current room
            const user = users.find(user => user.socketId === targetUserId);
            if (user) {
                return { available: true, room, user };
            }
        }
    }
    return { available: false };
}
server.listen(process.env.PORT || 7000, "0.0.0.0", () => console.log('server is running on port 8000'));