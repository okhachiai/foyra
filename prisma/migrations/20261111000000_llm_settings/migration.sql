-- Réglages LLM par foyer (remplacent les variables d'environnement).
ALTER TABLE "Household" ADD COLUMN "claudeApiKey" TEXT,
ADD COLUMN "claudeModel" TEXT,
ADD COLUMN "localLlmUrl" TEXT,
ADD COLUMN "localLlmModel" TEXT,
ADD COLUMN "localLlmApiKey" TEXT;
