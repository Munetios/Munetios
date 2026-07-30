import { notFound } from "next/navigation";
import ActivityExperience from "../activityExperience";
import "../styles.css";

export default async function ActivityPage({ params }) {
  const { activityName } = await params;
  if (!["anagrams", "chess", "wordhunt"].includes(activityName)) notFound();
  return <ActivityExperience activityName={activityName} />;
}
