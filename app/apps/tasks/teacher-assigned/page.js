import TasksWorkspace from "../components/tasksWorkspace";

export const metadata = {
  title: "Teacher Assigned | Munetios Tasks",
};

export default function TeacherAssignedTasksPage() {
  return <TasksWorkspace view="teacher-assigned" />;
}
