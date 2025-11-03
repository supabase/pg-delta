import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const testedProjects = JSON.parse(
  await readFile(join(__dirname, "tested-projects.json"), "utf-8"),
) as {
  reason?: string;
  projectId: string;
  status: "success" | "error";
  timestamp: string;
}[];

// count failed and successful projects
const failedProjectsCount = testedProjects.filter(
  (project) => project.status === "error",
).length;
const successfulProjectsCount = testedProjects.filter(
  (project) => project.status === "success",
).length;
console.log(`Failed projects: ${failedProjectsCount}`);
console.log(`Successful projects: ${successfulProjectsCount}`);

const failedProjects = testedProjects
  .filter((project) => project.status === "error")
  .sort((a, b) => a.projectId.localeCompare(b.projectId));

for (const project of failedProjects) {
  console.error(`Project ${project.projectId} failed: ${project.reason}`);
}

console.log(failedProjects.map((project) => project.projectId));
