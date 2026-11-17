"use client";

import { useState, useEffect } from "react";
import { QuickTemplatesProps, UserContext, Template } from "../types";
import { authFetch } from "../utils/authFetch";

export default function QuickTemplates({
  username,
  onSelectTemplate,
}: QuickTemplatesProps) {
  const [expanded, setExpanded] = useState(false);
  const [userContext, setUserContext] = useState<UserContext | null>(null);
  const [loading, setLoading] = useState(false);

  // Fetch user context (recent games, genres) if user is logged in
  useEffect(() => {
    if (!username) {
      setUserContext(null);
      return;
    }

    const fetchUserContext = async () => {
      setLoading(true);
      try {
        const response = await authFetch(
          `/api/user-context`
        );
        if (response.ok) {
          const data = await response.json();
          setUserContext(data);
        }
      } catch (error) {
        console.error("Error fetching user context:", error);
      } finally {
        setLoading(false);
      }
    };

    fetchUserContext();
  }, [username]);

  // General templates (always available)
  const generalTemplates: Template[] = [
    {
      id: "random-game",
      label: "Random Game",
      question: "Give me a random game recommendation",
      icon: "🎲",
      color: "bg-blue-500 hover:bg-blue-600",
      category: "general",
    },
    {
      id: "what-should-i-play",
      label: "What Should I Play?",
      question: "What should I play?",
      icon: "🎮",
      color: "bg-blue-600 hover:bg-blue-700",
      category: "general",
    },
    {
      id: "daily-tip",
      label: "Daily Tip",
      question: "Give me a daily gaming tip",
      icon: "💡",
      color: "bg-blue-400 hover:bg-blue-500",
      category: "general",
    },
  ];

  // Check if a game supports builds (RPGs, action-RPGs, etc.)
  const gameSupportsBuilds = (gameName: string): boolean => {
    if (!gameName) return false;

    const lowerGame = gameName.toLowerCase();

    // Games that typically have character builds
    const buildGames = [
      "dark souls",
      "elden ring",
      "bloodborne",
      "sekiro",
      "diablo",
      "path of exile",
      "grim dawn",
      "final fantasy",
      "dragon quest",
      "persona",
      "xenoblade",
      "mass effect",
      "dragon age",
      "baldur's gate",
      "pillars of eternity",
      "divinity",
      "witcher",
      "skyrim",
      "elder scrolls",
      "fallout",
      "monster hunter",
      "borderlands",
      "destiny",
      "the division",
      "pokemon",
      "fire emblem",
      "disgaea",
      "tactics",
      "hades",
      "dead cells",
      "rogue legacy",
    ];

    return buildGames.some((buildGame) => lowerGame.includes(buildGame));
  };

  // Generate game-specific templates from user's recent games
  // Only show "Best Build" for games that support builds
  // Show templates for the 2 most recent games (matching the header)
  const gameTemplates: Template[] = userContext?.recentGames
    ? userContext.recentGames.slice(0, 2).flatMap((game) => {
        const templates: Template[] = [
          {
            id: `beat-${game.toLowerCase().replace(/\s+/g, "-")}`,
            label: `Beat ${game}`,
            question: `How do I beat ${game}?`,
            icon: "⚔️",
            color: "bg-orange-500 hover:bg-orange-600",
            category: "game" as const,
            game,
          },
        ];

        // Only add "Best Build" template if the game supports builds
        if (gameSupportsBuilds(game)) {
          templates.push({
            id: `build-${game.toLowerCase().replace(/\s+/g, "-")}`,
            label: `Best Build for ${game}`,
            question: `What is the best build for ${game}?`,
            icon: "🛡️",
            color: "bg-orange-600 hover:bg-orange-700",
            category: "game" as const,
            game,
          });
        }

        templates.push({
          id: `secrets-${game.toLowerCase().replace(/\s+/g, "-")}`,
          label: `Secrets in ${game}`,
          question: `What are the hidden secrets in ${game}?`,
          icon: "🔍",
          color: "bg-orange-400 hover:bg-orange-500",
          category: "game" as const,
          game,
        });

        return templates;
      })
    : [];

  // Normalize genre names from achievement-style (e.g., "adventureAddict") to proper genre names (e.g., "adventure")
  const normalizeGenreName = (genre: string): string => {
    if (!genre) return genre;

    const lowerGenre = genre.toLowerCase().trim();
    const normalizedInternal = lowerGenre.replace(/\s+/g, "");

    // Map achievement-style names to proper genre names
    const genreMap: { [key: string]: string } = {
      platformerpro: "platformer",
      "platformer pro": "platformer",
      rpgenthusiast: "RPG",
      "rpg enthusiast": "RPG",
      actionaficionado: "action",
      "action aficionado": "action",
      shooterspecialist: "shooter",
      "shooter specialist": "shooter",
      strategyspecialist: "strategy",
      "strategy specialist": "strategy",
      adventureaddict: "adventure",
      "adventure addict": "adventure",
      puzzlepro: "puzzle",
      "puzzle pro": "puzzle",
      fightingfanatic: "fighting",
      "fighting fanatic": "fighting",
      racingrenegade: "racing",
      "racing renegade": "racing",
      sportschampion: "sports",
      "sports champion": "sports",
      survivalspecialist: "survival",
      "survival specialist": "survival",
      horrorhero: "horror",
      "horror hero": "horror",
      stealthexpert: "stealth",
      "stealth expert": "stealth",
      simulationspecialist: "simulation",
      "simulation specialist": "simulation",
      sandboxbuilder: "sandbox",
      "sandbox builder": "sandbox",
      shootemupsniper: "shootem up",
      "shootem up sniper": "shootem up",
    };

    // Check normalized internal name first
    if (genreMap[normalizedInternal]) {
      return genreMap[normalizedInternal];
    }

    // Check direct match
    if (genreMap[lowerGenre]) {
      return genreMap[lowerGenre];
    }

    // If no mapping found, capitalize first letter of each word
    return genre
      .split(/\s+/)
      .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
      .join(" ");
  };

  // Use preferences.dominantGenres if available, otherwise fall back to topGenres
  const genresToUse =
    userContext?.preferences?.dominantGenres &&
    userContext.preferences.dominantGenres.length > 0
      ? userContext.preferences.dominantGenres
      : userContext?.topGenres;

  // Generate genre-specific templates from user's genres (normalized)
  const genreTemplates: Template[] = genresToUse
    ? genresToUse.slice(0, 2).flatMap((genre) => {
        const normalizedGenre = normalizeGenreName(genre);
        return [
          {
            id: `best-${normalizedGenre.toLowerCase().replace(/\s+/g, "-")}`,
            label: `Best ${normalizedGenre} Games`,
            question: `What are the best ${normalizedGenre.toLowerCase()} games right now?`,
            icon: "🏆",
            color: "bg-green-500 hover:bg-green-600",
            category: "genre" as const,
            genre: normalizedGenre,
          },
          {
            id: `beginner-${normalizedGenre
              .toLowerCase()
              .replace(/\s+/g, "-")}`,
            label: `${normalizedGenre} for Beginners`,
            question: `What are the best ${normalizedGenre.toLowerCase()} games for beginners?`,
            icon: "🌱",
            color: "bg-green-600 hover:bg-green-700",
            category: "genre" as const,
            genre: normalizedGenre,
          },
        ];
      })
    : [];

  // Generate preference-based templates
  const preferenceTemplates: Template[] = [];

  if (userContext?.preferences) {
    const { playstyleTags, difficultyPreference, recentInterests } =
      userContext.preferences;

    // Playstyle-based templates
    if (playstyleTags && playstyleTags.length > 0) {
      if (playstyleTags.includes("completionist")) {
        preferenceTemplates.push({
          id: "completionist-games",
          label: "Games for Completionists",
          question: "What are the best games for completionists?",
          icon: "✅",
          color: "bg-emerald-500 hover:bg-emerald-600",
          category: "genre" as const,
        });
      }
      if (playstyleTags.includes("challenge_seeker")) {
        preferenceTemplates.push({
          id: "challenging-games",
          label: "Challenging Games",
          question: "What are the most challenging games?",
          icon: "🔥",
          color: "bg-orange-500 hover:bg-orange-600",
          category: "genre" as const,
        });
      }
      if (playstyleTags.includes("explorer")) {
        preferenceTemplates.push({
          id: "exploration-games",
          label: "Exploration Games",
          question: "What are the best games for exploration?",
          icon: "🗺️",
          color: "bg-teal-500 hover:bg-teal-600",
          category: "genre" as const,
        });
      }
    }

    // Difficulty-based templates
    if (difficultyPreference) {
      if (difficultyPreference === "prefers_challenge") {
        preferenceTemplates.push({
          id: "hard-games",
          label: "Hard Games",
          question: "What are the hardest games?",
          icon: "💀",
          color: "bg-red-600 hover:bg-red-700",
          category: "genre" as const,
        });
      } else if (difficultyPreference === "casual") {
        preferenceTemplates.push({
          id: "casual-games",
          label: "Casual Games",
          question: "What are the best casual games?",
          icon: "😌",
          color: "bg-blue-400 hover:bg-blue-500",
          category: "genre" as const,
        });
      }
    }

    // Recent interests templates (if different from dominant genres)
    if (recentInterests && recentInterests.length > 0) {
      const uniqueInterests = recentInterests.filter(
        (interest) => !genresToUse?.includes(interest)
      );
      uniqueInterests.slice(0, 1).forEach((interest) => {
        preferenceTemplates.push({
          id: `interest-${interest.toLowerCase().replace(/\s+/g, "-")}`,
          label: `Trending: ${interest}`,
          question: `What are the best ${interest} games?`,
          icon: "📈",
          color: "bg-pink-500 hover:bg-pink-600",
          category: "genre" as const,
          genre: interest,
        });
      });
    }
  }

  // Smart prioritization function
  const calculateTemplatePriority = (template: Template): number => {
    let priority = 0;
    const matchReasons: string[] = [];

    if (!userContext) {
      return priority; // No prioritization for anonymous users
    }

    const now = new Date();
    const currentHour = now.getHours();
    const { activity, questionPatterns, recentGames } = userContext;

    // 1. Recent Activity Boost
    if (activity?.lastQuestionTime) {
      const lastQuestionTime = new Date(activity.lastQuestionTime);
      const hoursSinceLastQuestion =
        (now.getTime() - lastQuestionTime.getTime()) / (1000 * 60 * 60);

      // Boost templates if user was active recently (within last 24 hours)
      if (hoursSinceLastQuestion < 24) {
        priority += 20;
        matchReasons.push("recent activity");
      }

      // Boost game-specific templates for recently active games
      if (template.game && recentGames && recentGames.includes(template.game)) {
        const gameIndex = recentGames.indexOf(template.game);
        // More recent games get higher priority
        priority += 30 - gameIndex * 5;
        matchReasons.push(`recent game: ${template.game}`);
      }
    }

    // 2. Time of Day Matching
    if (activity?.peakActivityHours && activity.peakActivityHours.length > 0) {
      const isPeakHour = activity.peakActivityHours.includes(currentHour);

      if (isPeakHour) {
        // User is active during this time - boost all templates
        priority += 15;
        matchReasons.push("peak activity time");
      } else {
        // Check if current time matches typical gaming hours
        const isMorning = currentHour >= 6 && currentHour < 12;
        const isAfternoon = currentHour >= 12 && currentHour < 18;
        const isEvening = currentHour >= 18 && currentHour < 22;
        const isNight = currentHour >= 22 || currentHour < 6;

        // Boost specific templates based on time of day
        if (
          isMorning &&
          (template.label.includes("Tip") || template.label.includes("Daily"))
        ) {
          priority += 10;
          matchReasons.push("morning tip");
        }
        if (isEvening && template.label.includes("Beat")) {
          priority += 10;
          matchReasons.push("evening challenge");
        }
        if (
          isNight &&
          (template.label.includes("Random") ||
            template.label.includes("What Should"))
        ) {
          priority += 10;
          matchReasons.push("night discovery");
        }
      }
    }

    // 3. Question Pattern Matching
    if (questionPatterns) {
      const questionLower = template.question.toLowerCase();
      const labelLower = template.label.toLowerCase();

      // Match common question categories
      if (questionPatterns.commonCategories) {
        questionPatterns.commonCategories.forEach((category) => {
          const categoryLower = category.toLowerCase();
          if (
            questionLower.includes(categoryLower) ||
            labelLower.includes(categoryLower)
          ) {
            priority += 25;
            matchReasons.push(`matches category: ${category}`);
          }
        });
      }

      // Match recent question types
      if (questionPatterns.recentQuestionTypes) {
        questionPatterns.recentQuestionTypes.forEach((type) => {
          if (questionLower.includes(type) || labelLower.includes(type)) {
            priority += 20;
            matchReasons.push(`matches pattern: ${type}`);
          }
        });
      }

      // Specific pattern matching
      if (questionPatterns.recentQuestionTypes?.includes("how to")) {
        if (template.label.includes("Beat") || template.label.includes("How")) {
          priority += 15;
          matchReasons.push("how-to pattern");
        }
      }
      if (questionPatterns.recentQuestionTypes?.includes("best")) {
        if (template.label.includes("Best") || template.label.includes("Top")) {
          priority += 15;
          matchReasons.push("best/top pattern");
        }
      }
      if (questionPatterns.recentQuestionTypes?.includes("tips")) {
        if (
          template.label.includes("Tip") ||
          template.label.includes("Advice")
        ) {
          priority += 15;
          matchReasons.push("tips pattern");
        }
      }
      if (questionPatterns.recentQuestionTypes?.includes("build")) {
        if (
          template.label.includes("Build") ||
          template.label.includes("Setup")
        ) {
          priority += 15;
          matchReasons.push("build pattern");
        }
      }
      if (questionPatterns.recentQuestionTypes?.includes("secrets")) {
        if (
          template.label.includes("Secret") ||
          template.label.includes("Hidden")
        ) {
          priority += 15;
          matchReasons.push("secrets pattern");
        }
      }
    }

    // 4. Activity Frequency Boost
    if (activity?.questionsToday && activity.questionsToday >= 5) {
      // Very active user - boost personalized templates
      if (template.category === "game" || template.category === "genre") {
        priority += 10;
        matchReasons.push("high activity");
      }
    }

    // Store priority and match reasons
    template.priority = priority;
    template.matchReason =
      matchReasons.length > 0 ? matchReasons.join(", ") : undefined;

    return priority;
  };

  // Calculate priorities for all templates
  const allTemplatesWithPriority = [
    ...generalTemplates,
    ...preferenceTemplates,
    ...gameTemplates,
    ...genreTemplates,
  ].map((template) => {
    calculateTemplatePriority(template);
    return template;
  });

  // Remove duplicate questions (keep the one with higher priority)
  const uniqueTemplates = new Map<string, Template>();
  for (const template of allTemplatesWithPriority) {
    const questionKey = template.question.toLowerCase().trim();
    const existing = uniqueTemplates.get(questionKey);

    if (!existing || (template.priority || 0) > (existing.priority || 0)) {
      uniqueTemplates.set(questionKey, template);
    }
  }

  const allTemplatesDeduplicated = Array.from(uniqueTemplates.values());

  // Sort templates by priority (highest first), then by category
  const allTemplates = allTemplatesDeduplicated.sort((a, b) => {
    // First sort by priority
    if ((b.priority || 0) !== (a.priority || 0)) {
      return (b.priority || 0) - (a.priority || 0);
    }
    // Then by category preference: preference > game > genre > general
    const categoryOrder: Record<string, number> = {
      general: 0,
      genre: 1,
      game: 2,
    };
    return (categoryOrder[b.category] || 0) - (categoryOrder[a.category] || 0);
  });

  // Templates to show initially (collapsed state): Only general templates
  const initialTemplates = generalTemplates;

  // Create a Set of preference template IDs for efficient lookup
  const preferenceTemplateIds = new Set(preferenceTemplates.map((t) => t.id));

  // Group templates by category for better organization (maintain priority order within groups)
  const templateGroups = [
    {
      name: "General",
      templates: allTemplates.filter((t) => t.category === "general"),
      isPersonalized: false,
      showHeader:
        expanded ||
        allTemplates.filter((t) => t.category === "general").length > 3,
    },
    {
      name: "For You",
      templates: allTemplates.filter((t) => preferenceTemplateIds.has(t.id)),
      isPersonalized: true,
      showHeader: expanded && preferenceTemplates.length > 0,
    },
    {
      name: userContext?.recentGames?.length
        ? `Your Games (${userContext.recentGames.slice(0, 2).join(", ")})`
        : "Your Games",
      templates: allTemplates.filter((t) => t.category === "game"),
      isPersonalized: true,
      showHeader: expanded && gameTemplates.length > 0,
    },
    {
      name: genresToUse?.length
        ? `${genresToUse.slice(0, 2).join(" & ")} Games`
        : "Genre Games",
      templates: allTemplates.filter(
        (t) => t.category === "genre" && !preferenceTemplateIds.has(t.id)
      ),
      isPersonalized: true,
      showHeader: expanded && genreTemplates.length > 0,
    },
  ].filter((group) => group.templates.length > 0);

  // Check if there are personalized templates to show when expanded
  const hasPersonalizedTemplates =
    gameTemplates.length > 0 ||
    genreTemplates.length > 0 ||
    preferenceTemplates.length > 0;

  const hasMoreTemplates = hasPersonalizedTemplates;

  return (
    <div className="w-full max-w-2xl mb-3">
      {/* Show user context info when available */}
      {userContext &&
        ((userContext.recentGames && userContext.recentGames.length > 0) ||
          (genresToUse && genresToUse.length > 0)) && (
          <div className="mb-2 text-xs text-gray-400 flex flex-wrap gap-2 items-center">
            {userContext.recentGames && userContext.recentGames.length > 0 && (
              <span className="flex items-center gap-1">
                <span>🎮</span>
                <span>
                  Playing: {userContext.recentGames.slice(0, 2).join(", ")}
                </span>
              </span>
            )}
            {genresToUse && genresToUse.length > 0 && (
              <span className="flex items-center gap-1">
                <span>🏷️</span>
                <span>Genres: {genresToUse.slice(0, 2).join(", ")}</span>
              </span>
            )}
          </div>
        )}

      {/* Template groups */}
      {expanded ? (
        // Expanded: Show grouped templates with headers
        <div className="space-y-2">
          {templateGroups.map(
            (group: {
              name: string;
              templates: Template[];
              isPersonalized: boolean;
              showHeader: boolean;
            }) => (
              <div key={group.name} className="space-y-1">
                {/* Category header */}
                {group.showHeader && (
                  <div className="flex items-center gap-2">
                    <h4 className="text-xs font-semibold text-gray-400 uppercase tracking-wide">
                      {group.name}
                    </h4>
                    {group.isPersonalized && (
                      <span className="text-xs bg-gradient-to-r from-cyan-500 to-pink-500 text-white px-1.5 py-0.5 rounded">
                        ✨ Personalized
                      </span>
                    )}
                  </div>
                )}

                {/* Template buttons - Responsive grid layout: 2 cols mobile, 3 cols tablet, 4 cols desktop */}
                <div
                  className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-1.5"
                  style={{ gridAutoColumns: "minmax(0, 1fr)" }}
                >
                  {group.templates.map((template: Template) => (
                    <button
                      key={template.id}
                      type="button"
                      onClick={() => onSelectTemplate(template.question)}
                      className={`px-1.5 py-0.5 text-xs leading-tight ${template.color} text-white rounded transition-colors flex items-center justify-center gap-0.5 relative group w-full min-w-0`}
                      title={template.question}
                    >
                      <span className="flex-shrink-0 leading-none">
                        {template.icon}
                      </span>
                      <span className="truncate flex-1 min-w-0 max-w-full">
                        {template.label}
                      </span>
                      {/* Priority indicator for smart suggestions */}
                      {template.priority && template.priority > 30 && (
                        <span
                          className="text-xs flex-shrink-0"
                          title={template.matchReason || "Smart suggestion"}
                        >
                          ⭐
                        </span>
                      )}
                      {/* Personalized indicator badge */}
                      {group.isPersonalized && !group.showHeader && (
                        <span className="absolute -top-1 -right-1 w-2 h-2 bg-yellow-400 rounded-full border border-white"></span>
                      )}
                    </button>
                  ))}
                </div>
              </div>
            )
          )}
        </div>
      ) : (
        // Collapsed: Show only general templates (3 buttons in a single row)
        <div
          className="grid grid-cols-3 gap-1.5"
          style={{ gridAutoColumns: "minmax(0, 1fr)" }}
        >
          {initialTemplates.map((template) => {
            return (
              <button
                key={template.id}
                type="button"
                onClick={() => onSelectTemplate(template.question)}
                className={`px-1.5 py-0.5 text-xs leading-tight ${template.color} text-white rounded transition-colors flex items-center justify-center gap-0.5 relative group w-full min-w-0`}
                title={template.question}
              >
                <span className="flex-shrink-0 leading-none">
                  {template.icon}
                </span>
                <span className="truncate flex-1 min-w-0 max-w-full">
                  {template.label}
                </span>
              </button>
            );
          })}
        </div>
      )}

      {/* Expand/Collapse button */}
      {hasMoreTemplates && (
        <div className="mt-3 flex justify-center">
          <button
            type="button"
            onClick={() => setExpanded(!expanded)}
            className="px-4 py-2 text-sm bg-gray-700 hover:bg-gray-600 text-white rounded-lg transition-colors flex items-center gap-2 border border-gray-600"
            aria-label={
              expanded ? "Show fewer templates" : "Show more templates"
            }
          >
            <span className="text-xs">{expanded ? "▲" : "▼"}</span>
            <span>
              {expanded
                ? "Show Less"
                : `Show More (${
                    allTemplates.length - initialTemplates.length
                  } personalized)`}
            </span>
          </button>
        </div>
      )}

      {/* Show loading indicator while fetching user context */}
      {loading && username && (
        <div className="text-xs text-gray-400 mt-2 text-center">
          Loading personalized templates...
        </div>
      )}
    </div>
  );
}
