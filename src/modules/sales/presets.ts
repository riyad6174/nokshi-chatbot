import type { Industry, SalesConfigInput } from "@/modules/sales/config";

// Starting configurations per industry. Store owners customise them in Admin → AI Sales & Engagement;
// nothing here is special-cased in the chatbot code. Relationship terms are matched loosely against
// product categories and names (singular/plural, case-insensitive), so they work with most catalogs.

const OFF = { enabled: false, delaySeconds: 0 };

const GENERAL: SalesConfigInput = {
  industry: "general",
  persona: {
    role: "a helpful shopping assistant",
    personality: "Friendly and knowledgeable; helps the customer find the right product quickly.",
  },
  conversationRules: [],
  recommendation: { strategy: "balanced", maxPerReply: 3, maxAddOnsPerConversation: 2, explainReasons: true },
  engagement: {
    // Off by default so existing stores don't start sending proactive messages.
    enabled: false,
    triggers: {
      search: OFF,
      product_view: { enabled: true, delaySeconds: 25 },
      compare: { enabled: true, delaySeconds: 0 },
      add_to_cart: { enabled: true, delaySeconds: 0 },
      cart_idle: { enabled: true, delaySeconds: 300 },
      checkout_start: OFF,
    },
    maxPerSession: 3,
    minSecondsBetween: 120,
    suppressDuringCheckout: true,
    nudgeWhenClosed: true,
  },
  messages: {
    complementary: "{suggestions} go well with {product}. Want to take a look?",
    complete_the_look: "{product} looks great with {suggestions}. Want to see them?",
    compatible: "{suggestions} work with {product}. Shall I show you?",
    recipe: "Making {recipe}? {suggestions} would go perfectly with it. Want me to show them?",
    cart_idle: "Still deciding? I can answer questions about {product} or find you an alternative.",
    checkout_start: "",
  },
};

const GROCERY: SalesConfigInput = {
  industry: "grocery",
  businessType: "Grocery and food store",
  persona: {
    role: "a friendly grocery shopping and cooking assistant",
    personality:
      "Warm and practical, like a neighbourhood grocer who loves to cook. Thinks in meals, not just items, and keeps the customer's budget in mind.",
  },
  conversationRules: [
    "When the customer names an ingredient, ask ONE short question about the dish (e.g. a curry or something crispy?), then suggest the other ingredients for that dish using get_recommendations kind 'recipe' with need set to the dish.",
    "If an item is unavailable, offer a substitute with get_recommendations kind 'similar' and say it's a substitute.",
    "Help build a shopping list for a meal or the week when asked; add each item the customer agrees to.",
    "For budget questions, suggest the cheaper staples first (get_recommendations kind 'cheaper').",
    "Only mention pack sizes, freshness or origin when the catalog says so.",
  ],
  recommendation: { strategy: "complementary_first", maxPerReply: 3, maxAddOnsPerConversation: 3, explainReasons: true },
  recipes: [
    { name: "potato curry", ingredients: ["potato", "onion", "green chili", "turmeric", "garlic", "oil"] },
    { name: "crispy potato fries", ingredients: ["potato", "oil", "salt", "chili powder"] },
    { name: "chicken curry", ingredients: ["chicken", "onion", "garlic", "ginger", "green chili", "turmeric", "oil"] },
    { name: "egg curry", ingredients: ["egg", "onion", "tomato", "green chili", "turmeric"] },
    { name: "dal", ingredients: ["lentil", "onion", "garlic", "turmeric", "green chili"] },
    { name: "khichuri", ingredients: ["rice", "lentil", "onion", "ghee", "green chili"] },
    { name: "fried rice", ingredients: ["rice", "egg", "carrot", "peas", "soy sauce"] },
    { name: "fresh salad", ingredients: ["cucumber", "tomato", "onion", "lemon"] },
    { name: "milk tea", ingredients: ["tea", "milk", "sugar"] },
  ],
  relationships: [
    { from: "Tea", to: ["Milk", "Sugar", "Biscuits"], kind: "complementary", reason: "{to} for your tea" },
    { from: "Bread", to: ["Butter", "Eggs", "Jam"], kind: "complementary", reason: "{to} for breakfast" },
    { from: "Pasta", to: ["Sauce", "Cheese"], kind: "complementary", reason: "{to} to finish the dish" },
    { from: "Rice", to: ["Lentils", "Oil"], kind: "complementary", reason: "Everyday staples with rice" },
  ],
  synonyms: {
    aloo: ["potato"],
    alu: ["potato"],
    piyaj: ["onion"],
    peyaj: ["onion"],
    morich: ["chili"],
    dim: ["egg"],
    chal: ["rice"],
    daal: ["lentil"],
    dal: ["lentil"],
  },
  engagement: {
    enabled: true,
    triggers: {
      search: { enabled: true, delaySeconds: 0 },
      product_view: { enabled: true, delaySeconds: 20 },
      compare: OFF,
      add_to_cart: { enabled: true, delaySeconds: 0 },
      cart_idle: { enabled: true, delaySeconds: 300 },
      checkout_start: OFF,
    },
    maxPerSession: 4,
    minSecondsBetween: 90,
    suppressDuringCheckout: true,
    nudgeWhenClosed: true,
  },
  messages: {
    recipe: "Planning {recipe}? {suggestions} would go perfectly with it. I can help you find those too.",
    complementary: "{suggestions} go nicely with {product}. Want them on your list?",
    cart_idle: "Anything else for tonight's cooking? I can suggest what goes with {product}.",
  },
};

const FASHION: SalesConfigInput = {
  industry: "fashion",
  businessType: "Fashion and apparel store",
  persona: {
    role: "a friendly personal stylist",
    personality: "Upbeat, encouraging and tasteful. Suggests complete outfits, never comments on the customer's body.",
  },
  conversationRules: [
    "When the customer looks at or adds an item, suggest ONE way to complete the look with get_recommendations kind 'complete_the_look' and say why it pairs well (colour, style or occasion from the reason given).",
    "Ask about the occasion (office, casual, wedding, Eid) when it would change the recommendation.",
    "Size and fit: use only the sizes on the card and the product details; if the customer is between sizes, say what the catalog says about fit or suggest asking a person.",
    "Coordinate colours using the reasons the tool gives; never claim a colour that isn't in the catalog.",
  ],
  recommendation: { strategy: "complementary_first", maxPerReply: 3, maxAddOnsPerConversation: 2, explainReasons: true },
  relationships: [
    { from: "Shirts", to: ["Pants", "Chinos", "Trousers", "Belts", "Shoes"], kind: "complete_the_look", reason: "{to} to complete the look" },
    { from: "T-shirts", to: ["Jeans", "Shorts", "Sneakers", "Caps"], kind: "complete_the_look", reason: "{to} for an easy casual look" },
    { from: "Pants", to: ["Shirts", "Belts", "Shoes"], kind: "complete_the_look", reason: "{to} to wear with them" },
    { from: "Jeans", to: ["T-shirts", "Shirts", "Sneakers", "Belts"], kind: "complete_the_look", reason: "{to} to wear with them" },
    { from: "Panjabi", to: ["Pajama", "Sandals", "Attar"], kind: "complete_the_look", reason: "{to} for a festive look" },
    { from: "Saree", to: ["Blouse", "Jewelry", "Bags"], kind: "complete_the_look", reason: "{to} to finish the outfit" },
    { from: "Dresses", to: ["Heels", "Bags", "Jewelry"], kind: "complete_the_look", reason: "{to} to finish the outfit" },
    { from: "Shoes", to: ["Socks", "Belts"], kind: "complementary", reason: "{to} to go with them" },
  ],
  colorPairings: {
    white: ["beige", "navy", "black", "grey", "khaki", "blue", "olive"],
    blue: ["beige", "white", "grey", "khaki", "navy"],
    "light blue": ["beige", "navy", "white", "grey", "khaki"],
    navy: ["beige", "white", "grey", "khaki"],
    black: ["grey", "white", "beige", "black"],
    grey: ["black", "navy", "white"],
    beige: ["white", "navy", "olive", "brown", "black"],
    olive: ["beige", "white", "black", "khaki"],
    pink: ["white", "grey", "navy", "beige"],
    maroon: ["beige", "white", "grey", "black"],
  },
  engagement: {
    enabled: true,
    triggers: {
      search: OFF,
      product_view: { enabled: true, delaySeconds: 20 },
      compare: { enabled: true, delaySeconds: 0 },
      add_to_cart: { enabled: true, delaySeconds: 0 },
      cart_idle: { enabled: true, delaySeconds: 300 },
      checkout_start: OFF,
    },
    maxPerSession: 3,
    minSecondsBetween: 120,
    suppressDuringCheckout: true,
    nudgeWhenClosed: true,
  },
  messages: {
    complete_the_look: "That {product} would look great with {suggestions} for a clean, smart-casual look. Would you like to see the matching options?",
    complementary: "{suggestions} would go nicely with {product}. Want to see them?",
    cart_idle: "Need a hand with sizing or matching {product}? Just ask.",
  },
};

const ELECTRONICS: SalesConfigInput = {
  industry: "electronics",
  businessType: "Electronics store",
  persona: {
    role: "a knowledgeable, honest product advisor",
    personality: "Clear and precise. Explains trade-offs in plain words and never oversells specs.",
  },
  conversationRules: [
    "Ask what the customer will use it for and their budget before recommending, one question at a time.",
    "Suggest accessories only with get_recommendations kind 'compatible', and only those it returns; say what they're compatible with.",
    "Compare products with compare_products using catalog specs only; never state a spec the catalog doesn't give.",
    "For budget limits, use get_recommendations kind 'cheaper' or search with maxPriceMinor.",
  ],
  recommendation: { strategy: "balanced", maxPerReply: 3, maxAddOnsPerConversation: 2, explainReasons: true },
  compatibilityAttributes: ["compatible_with", "compatibility", "connector", "port", "model", "socket", "mount"],
  relationships: [
    { from: "Phones", to: ["Cases", "Chargers", "Screen protectors", "Earbuds", "Cables"], kind: "compatible", reason: "Works with your {from}" },
    { from: "Laptops", to: ["Laptop bags", "Mouse", "Chargers", "Keyboards", "Hubs"], kind: "compatible", reason: "Works with your {from}" },
    { from: "Cameras", to: ["Memory cards", "Tripods", "Camera bags", "Batteries"], kind: "compatible", reason: "Works with your {from}" },
    { from: "TVs", to: ["Wall mounts", "HDMI cables", "Soundbars"], kind: "compatible", reason: "Works with your {from}" },
    { from: "Consoles", to: ["Controllers", "Games", "Headsets"], kind: "compatible", reason: "Works with your {from}" },
  ],
  engagement: {
    enabled: true,
    triggers: {
      search: OFF,
      product_view: { enabled: true, delaySeconds: 30 },
      compare: { enabled: true, delaySeconds: 0 },
      add_to_cart: { enabled: true, delaySeconds: 0 },
      cart_idle: { enabled: true, delaySeconds: 300 },
      checkout_start: OFF,
    },
    maxPerSession: 3,
    minSecondsBetween: 120,
    suppressDuringCheckout: true,
    nudgeWhenClosed: true,
  },
  messages: {
    compatible: "{suggestions} are compatible with your {product}. Want me to show them?",
    complementary: "Most people pair {product} with {suggestions}. Want to take a look?",
    cart_idle: "Any questions about {product}? I can compare it with similar models.",
  },
};

const BEAUTY: SalesConfigInput = {
  industry: "beauty",
  businessType: "Beauty and personal care store",
  persona: {
    role: "a caring beauty advisor",
    personality: "Gentle and honest. Builds simple routines and never makes medical claims.",
  },
  conversationRules: [
    "Ask about skin or hair type when it matters for the recommendation, one question at a time.",
    "Build simple routines (cleanse, treat, moisturise, protect) from products the tools return.",
    "Mention ingredients or suitability only as the catalog states them; suggest a patch test for new skincare.",
  ],
  relationships: [
    { from: "Cleansers", to: ["Toners", "Moisturizers"], kind: "bundle", reason: "Next step in your routine" },
    { from: "Moisturizers", to: ["Sunscreen", "Serums"], kind: "bundle", reason: "Completes your routine" },
    { from: "Shampoo", to: ["Conditioner", "Hair oil"], kind: "bundle", reason: "Completes your hair care" },
    { from: "Lipstick", to: ["Lip liner", "Makeup remover"], kind: "complementary", reason: "Goes with {from}" },
  ],
  engagement: {
    enabled: true,
    triggers: {
      search: OFF,
      product_view: { enabled: true, delaySeconds: 25 },
      compare: OFF,
      add_to_cart: { enabled: true, delaySeconds: 0 },
      cart_idle: { enabled: true, delaySeconds: 300 },
      checkout_start: OFF,
    },
  },
  messages: {
    complementary: "{suggestions} would complete your routine with {product}. Want to see?",
  },
};

const HOME: SalesConfigInput = {
  industry: "home",
  businessType: "Home and furniture store",
  persona: {
    role: "a home and furniture consultant",
    personality: "Calm and thoughtful. Thinks about the whole room, sizes and style.",
  },
  conversationRules: [
    "Ask which room and style the customer has in mind when it changes the suggestion.",
    "Quote dimensions, materials and assembly only from the catalog.",
    "Suggest matching pieces for the room with get_recommendations kind 'complete_the_look'.",
  ],
  relationships: [
    { from: "Sofas", to: ["Cushions", "Throws", "Rugs", "Coffee tables"], kind: "complete_the_look", reason: "{to} to finish the room" },
    { from: "Beds", to: ["Mattresses", "Bedsheets", "Pillows"], kind: "bundle", reason: "Everything for the bed" },
    { from: "Tables", to: ["Chairs", "Table runners"], kind: "complete_the_look", reason: "{to} to go with it" },
    { from: "Curtains", to: ["Curtain rods"], kind: "compatible", reason: "Needed to hang them" },
  ],
  engagement: {
    enabled: true,
    triggers: {
      search: OFF,
      product_view: { enabled: true, delaySeconds: 30 },
      compare: { enabled: true, delaySeconds: 0 },
      add_to_cart: { enabled: true, delaySeconds: 0 },
      cart_idle: { enabled: true, delaySeconds: 300 },
      checkout_start: OFF,
    },
  },
};

const SPORTS: SalesConfigInput = {
  industry: "sports",
  businessType: "Sports and outdoor store",
  persona: {
    role: "a sports gear coach",
    personality: "Energetic and practical. Matches gear to the sport and the customer's level.",
  },
  conversationRules: [
    "Ask which sport and level (beginner, regular, competitive) when it changes the recommendation.",
    "Suggest the essential gear for the activity with get_recommendations kind 'bundle'.",
  ],
  relationships: [
    { from: "Football", to: ["Football boots", "Shin guards", "Socks"], kind: "bundle", reason: "Essential for football" },
    { from: "Cricket bats", to: ["Cricket balls", "Gloves", "Pads"], kind: "bundle", reason: "Essential for cricket" },
    { from: "Running shoes", to: ["Socks", "Water bottles"], kind: "complementary", reason: "Great for runs" },
    { from: "Yoga mats", to: ["Yoga blocks", "Straps"], kind: "bundle", reason: "Completes your yoga kit" },
  ],
  engagement: {
    enabled: true,
    triggers: {
      search: OFF,
      product_view: { enabled: true, delaySeconds: 25 },
      compare: OFF,
      add_to_cart: { enabled: true, delaySeconds: 0 },
      cart_idle: { enabled: true, delaySeconds: 300 },
      checkout_start: OFF,
    },
  },
};

const PRESETS: Record<Industry, SalesConfigInput> = {
  general: GENERAL,
  grocery: GROCERY,
  fashion: FASHION,
  electronics: ELECTRONICS,
  beauty: BEAUTY,
  home: HOME,
  sports: SPORTS,
};

/** A deep copy of an industry preset (with the general preset's defaults underneath). */
export function industryPreset(industry: Industry): SalesConfigInput {
  const base = structuredClone(GENERAL);
  const preset = structuredClone(PRESETS[industry] ?? GENERAL);
  // Shallow-merge nested sections so presets only state what differs from the general one.
  return {
    ...base,
    ...preset,
    engagement: { ...base.engagement, ...preset.engagement, triggers: { ...base.engagement?.triggers, ...preset.engagement?.triggers } },
    messages: { ...base.messages, ...preset.messages },
    recommendation: { ...base.recommendation, ...preset.recommendation },
  };
}
