export const classificationBadgeClass = (classification: string): string => {
  switch (classification.toLowerCase()) {
    case "regular":
      return "bg-blue-50 text-blue-700";
    case "single":
      return "bg-purple-50 text-purple-700";
    case "pa":
      return "bg-amber-50 text-amber-700";
    case "hsg":
      return "bg-emerald-50 text-emerald-700";
    case "pl":
      return "bg-rose-50 text-rose-700";
    default:
      return "bg-gray-100 text-gray-700";
  }
};

export const riderCategoryBadgeClass = (category: string): string => {
  switch (category.toLowerCase()) {
    case "critical illness":
      return "bg-rose-50 text-rose-700";
    case "premium waiver":
      return "bg-sky-50 text-sky-700";
    case "payor benefit":
      return "bg-amber-50 text-amber-700";
    case "disability":
      return "bg-orange-50 text-orange-700";
    case "term":
      return "bg-emerald-50 text-emerald-700";
    case "top-up":
      return "bg-blue-50 text-blue-700";
    case "accident & health":
    case "hospital":
      return "bg-teal-50 text-teal-700";
    case "pre-natal":
      return "bg-pink-50 text-pink-700";
    default:
      return "bg-gray-100 text-gray-700";
  }
};
