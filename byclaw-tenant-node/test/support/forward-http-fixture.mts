import { forwardFixture } from "./forward-pg-fixture.js";
import { createApp } from "../../src/interfaces/http/app.js";

// This executable is launched only by the opt-in Java cross-HTTP integration test.
const f = await forwardFixture();
const refs = [
  {
    id: "KG_DOC_FILE_71",
    resourceId: "71",
    resourceName: "Knowledge report",
    resourceType: "KG_DOC_FILE",
  },
  {
    id: "COMMON_FILE_72",
    resourceId: "/by/.sessions/source/report.txt",
    resourceName: "Workspace report",
    resourceType: "COMMON_FILE",
  },
  {
    id: "COMMON_FOLDER_73",
    resourceId: "/by/.sessions/source/folder",
    resourceName: "Directory name only",
    resourceType: "COMMON_FOLDER",
  },
  { id: "HUMAN_30", resourceId: "30", resourceName: "Human display", resourceType: "HUMAN" },
  { id: "AGENT_40", resourceId: "40", resourceName: "Agent display", resourceType: "AGENT" },
];
const upload = {
  fileId: "70",
  fileName: "report.txt",
  filePath: "/by/.sessions/source/upload.txt",
};
const published = {
  fileId: "74",
  fileName: "report.txt",
  filePath: "/by/.sessions/source/published.txt",
  cloudResourceId: "75",
};
await f.sql("UPDATE byai.byai_session SET project_id=70 WHERE session_id=10");
await f.sql(
  "UPDATE byai.byai_message SET message_content=$1,related_resources=$2,metadata=$3 WHERE message_id=101",
  [
    "{{KG_DOC_FILE_71}} {{COMMON_FILE_72}} {{COMMON_FOLDER_73}} {{HUMAN_30}} {{AGENT_40}}",
    JSON.stringify({ files: [upload] }),
    JSON.stringify({ resourceList: refs }),
  ],
);
await f.sql(
  "UPDATE byai.byai_message SET usage=2,creator_id=40,creator_name='Agent',message_content='Published result',metadata=$1 WHERE message_id=102",
  [JSON.stringify({ scene: "GROUP_CHAT", kind: "TASK_RESULT", taskId: "90", files: [published] })],
);
await f.sql(
  "INSERT INTO byai.byai_group_chat_task_publication(task_session_id,group_session_id,message_id,publisher_user_id,files_json) VALUES(90,10,102,30,$1)",
  [JSON.stringify([published])],
);
const app = createApp(
  { ...f.state, tenantId: "1", transport: "http", internalToken: "forward-fixture-only" } as any,
  {
    forwards: f.store,
    commands: {} as any,
    history: {} as any,
    sessions: {} as any,
    schema: {} as any,
    connected: () => f.connection.connected,
    ready: () => f.connection.ready,
    provisioned: () => f.connection.provisioned,
    schemaState: () => ({ observedVersion: "V0.6.0", auditedVersion: "V0.6.0", verified: true }),
    health: () => ({}),
  },
  undefined,
  { logger: false },
);
await app.listen({ host: "127.0.0.1", port: 0 });
console.log(JSON.stringify({ port: (app.server.address() as any).port }));
const close = async () => {
  await app.close();
  await f.close();
  process.exit(0);
};
process.on("SIGTERM", close);
process.on("SIGINT", close);
