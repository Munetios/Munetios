import TasksWorkspace from "../../components/tasksWorkspace";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function TasksListPage({ params }) {
  const { listName } = await params;

  return (
    <TasksWorkspace
      listSlug={listName}
      view="list"
    />
  );
}
