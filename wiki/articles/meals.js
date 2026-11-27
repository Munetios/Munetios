(() => {
  "use strict";
  const W = window.MunetiosWiki;
  const { pair, faq, table, link } = W.helpers;
  W.register({
    slug: "meals",
    title: "Munetios Meals",
    short: "Meals",
    logo: "images/logos/meals.png",
    category: "productivity",
    tagline: "Plan meals for the week, keep recipes and nutrition, and build a shopping list automatically.",
    url: "/meals/",
    updated: "2026-11-27",
    shots: [
      { src: "meals-desktop.jpg", phone: "meals-phone.jpg", caption: "Munetios Meals." },
    ],
    facts: {
      developer: "Munetios",
      type: "Meal planner",
      path: "/meals/ and Calendar → Meals",
      platforms: "Web",
      encryption: "End-to-end encrypted sync",
      sync: "Munetios Account",
      offline: "Yes",
      languages: "17 languages",
    },
    related: ["calendar", "tasks", "accounts"],
    sections: [
      {
        id: "overview", title: "Overview", icon: "restaurant",
        html: `
<p><strong>Munetios Meals</strong> plans breakfast, lunch, dinner, and snacks for the whole week. Each meal can be a full recipe with ingredients, steps, servings, nutrition, and dietary tags. Meals is also built into ${link("calendar", "Munetios Calendar")} as its Meals page, and syncs with end-to-end encryption when you sign in.</p>
${pair("meals-desktop.jpg", "meals-phone.jpg", "Munetios Meals.")}`,
      },
      {
        id: "planner", title: "Week planner", icon: "calendar_view_week",
        html: `<p>The week planner shows every day with slots for each meal type. Move between weeks, jump to this week, and add a meal on any day. <strong>Plan again</strong> reuses a meal you liked.</p>`,
      },
      {
        id: "recipes", title: "Recipes and nutrition", icon: "menu_book",
        html: `
${table(["Field", "Details"], [
  ["Servings", "Scale up or down with Fewer servings and More servings"], ["Prep and cook time", "In minutes"], ["Ingredients and steps", "One step per line"],
  ["Nutrition", "Calories (kcal), protein, carbs, and fat in grams"], ["Dietary tags", "Vegetarian, Vegan, Gluten-free, Dairy-free, High protein, Low carb, Nut-free"], ["Rating and notes", "Rate meals out of 5"],
])}
<p>Sort meals by newest, oldest, name, or calories, filter by dietary tag, and print a recipe.</p>`,
      },
      {
        id: "goals", title: "Calorie goal", icon: "monitor_heart",
        html: `<p>Set a daily calorie goal. The Today summary shows calories eaten against your goal, how much is left, or how far over you are.</p>`,
      },
      {
        id: "shopping", title: "Shopping list", icon: "shopping_cart",
        html: `<p>The shopping list combines ingredients from your upcoming meals (the next 7 days or all upcoming) into one list. Add your own items such as paper towels, check items off, clear checked items, copy the list, or download it.</p>`,
      },
      {
        id: "faq", title: "Frequently asked questions", icon: "help",
        html: faq([["Where else can I find Meals?", "In Munetios Calendar under Meals, at calendar/meals/."]]),
      },
    ],
  });
})();
