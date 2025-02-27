import React, { useEffect, useRef, useState } from "react";
import Peer from "simple-peer";
import styled from "styled-components";
import { useNavigate, useParams } from "react-router-dom";
import useWebSocket, { ReadyState } from "react-use-websocket";

const Container = styled.div`
  padding: 20px;
  display: flex;
  height: 100vh;
  width: 90%;
  margin: auto;
  flex-wrap: wrap;
`;

const StyledVideo = styled.video`
  height: 40%;
  width: 50%;
`;

const Video = ({ peer }) => {
    const ref = useRef();

    useEffect(() => {
        if (!peer) return;

        const handleStream = (stream) => {
            if (ref.current) {
                ref.current.srcObject = stream;
            }
        };

        peer.on("stream", handleStream);

        return () => {
            peer.off("stream", handleStream);
        };
    }, [peer]);

    return <StyledVideo playsInline autoPlay ref={ref} />;
};

const Room = () => {
    const [peers, setPeers] = useState([]);
    const userVideo = useRef();
    const peersRef = useRef([]);
    const { id: roomID } = useParams();
    const navigate = useNavigate();
    const [stream, setStream] = useState(null);

    // Initialize WebSocket
    const { sendJsonMessage, lastJsonMessage, readyState } = useWebSocket(
        `ws://localhost:5000`, // Replace with your WebSocket server URL
        {
            onOpen: () => console.log("WebSocket connected"),
            onClose: () => console.log("WebSocket disconnected"),
            onError: (err) => console.error("WebSocket error:", err),
            shouldReconnect: (closeEvent) => true, // Automatically reconnect
        }
    );

    // Get user media and join the room
    useEffect(() => {
        navigator.mediaDevices
            .getUserMedia({ video: true, audio: true })
            .then((mediaStream) => {
                userVideo.current.srcObject = mediaStream;
                setStream(mediaStream);
                // Join the room
                sendJsonMessage({ type: "join-room", roomID });
            })
            .catch((error) => console.error("Error accessing media devices.", error));
    }, [roomID, sendJsonMessage]);

    // Handle incoming messages
    useEffect(() => {
        if (!lastJsonMessage) return;

        const { type, payload } = lastJsonMessage;

        switch (type) {
            case "all-users":
                handleAllUsers(payload);
                break;
            case "user-joined":
                handleUserJoined(payload);
                break;
            case "user-disconnected":
                handleUserDisconnected(payload);
                break;
            case "receiving-returned-signal":
                handleReturnedSignal(payload);
                break;
            default:
                console.warn("Unknown WebSocket message type:", type);
        }
    }, [lastJsonMessage]);

    // Handle all users
    const handleAllUsers = (users) => {
        const newPeers = users.map((userID) => {
            const peer = createPeer(userID, stream);
            peersRef.current.push({ peerID: userID, peer });
            return { peerID: userID, peer };
        });
        setPeers(newPeers);
    };

    // Handle user joined
    const handleUserJoined = ({ callerID, signal }) => {
        const peer = addPeer(signal, callerID, stream);
        peersRef.current.push({ peerID: callerID, peer });
        setPeers((prev) => [...prev, { peerID: callerID, peer }]);
    };

    // Handle user disconnected
    const handleUserDisconnected = (userID) => {
        removePeer(userID);
    };

    // Handle returned signal
    const handleReturnedSignal = ({ id, signal }) => {
        const peerObj = peersRef.current.find((p) => p.peerID === id);
        if (peerObj?.peer) {
            try {
                peerObj.peer.signal(signal);
            } catch (error) {
                console.error(`Error signaling peer ${id}:`, error.message);
            }
        }
    };

    // Create a new peer
    const createPeer = (userToSignal, stream) => {
        const peer = new Peer({
            initiator: true,
            trickle: false,
            stream,
        });

        peer.on("signal", (signal) => {
            sendJsonMessage({
                type: "sending-signal",
                payload: { userToSignal, signal },
            });
        });

        peer.on("error", (err) => console.error("Peer error (createPeer):", err));

        return peer;
    };

    // Add a peer
    const addPeer = (incomingSignal, callerID, stream) => {
        const peer = new Peer({
            initiator: false,
            trickle: false,
            stream,
        });

        peer.on("signal", (signal) => {
            sendJsonMessage({
                type: "returning-signal",
                payload: { callerID, signal },
            });
        });

        peer.on("error", (err) => console.error("Peer error (addPeer):", err));

        try {
            peer.signal(incomingSignal);
        } catch (error) {
            console.error(`Error signaling incoming peer ${callerID}:`, error.message);
        }

        return peer;
    };

    // Remove a peer
    const removePeer = (userID) => {
        const peerObj = peersRef.current.find((p) => p.peerID === userID);

        if (peerObj?.peer) {
            peerObj.peer.destroy();
            peersRef.current = peersRef.current.filter((p) => p.peerID !== userID);
            setPeers((prev) => prev.filter((p) => p.peerID !== userID));
        }
    };

    return (
        <Container>
            <StyledVideo muted ref={userVideo} autoPlay playsInline />
            {peers.map(({ peer, peerID }) => (
                <div key={peerID}>
                    <button onClick={() => removePeer(peerID)}>Leave</button>
                    <Video peer={peer} />
                </div>
            ))}
        </Container>
    );
};

export default Room;