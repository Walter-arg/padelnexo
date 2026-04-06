export const mockInvitations = [
  {
    id: "invite-1",
    title: "Invitacion a partido",
    subtitle: "Sofia Mendez te invito para hoy 20:00 en Mendoza.",
  },
  {
    id: "invite-2",
    title: "Invitacion pendiente",
    subtitle: "Matias Benitez espera tu respuesta para manana 19:30.",
  },
];

export const mockMessages = [
  {
    id: "chat-player-2",
    playerId: "player-2",
    title: "Lucia Fernandez",
    subtitle: "Hola! Te va jugar el viernes?",
    messages: [
      { id: "chat-player-2-1", sender: "them", text: "Hola! Te va jugar el viernes?" },
      { id: "chat-player-2-2", sender: "me", text: "Si, despues de las 20:00 puedo." },
    ],
  },
  {
    id: "chat-player-1",
    playerId: "player-1",
    title: "Agustin Romero",
    subtitle: "Tenemos cancha libre el domingo.",
    messages: [
      { id: "chat-player-1-1", sender: "them", text: "Tenemos cancha libre el domingo." },
      { id: "chat-player-1-2", sender: "me", text: "Buenisimo, confirmame horario y me sumo." },
    ],
  },
];
