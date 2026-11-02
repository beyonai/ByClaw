import type { GroupForwardService } from "./group-forward-service.js";
/** Transactional typed forwarding use cases; whole-checkpoint replacement remains a private SQL primitive. */
export interface GroupChatForwardStore extends GroupForwardService {}
