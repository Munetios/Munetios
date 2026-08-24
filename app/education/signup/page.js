import { redirect } from "next/navigation";

export const metadata = {
  title: "Sign up for Education | Munetios",
};

export default function EducationSignupPage() {
  redirect("/signin?signup=education");
}
