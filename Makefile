.DEFAULT_GOAL := help

DEV = docker compose -f docker-compose.yml -f docker-compose.dev.yml

.PHONY: help dev dev-logs dev-stop up logs deploy-remote

help: ## Afficher les commandes disponibles
	@awk 'BEGIN { FS = ":.*## " } /^[a-z-]+:.*## / { printf "  make %-14s %s\n", $$1, $$2 }' $(MAKEFILE_LIST)

dev: ## Local : serveur de développement avec rechargement à chaud
	$(DEV) up -d --build --renew-anon-volumes

dev-logs: ## Local : suivre les logs du serveur de développement
	$(DEV) logs --tail=100 -f app

dev-stop: ## Local : arrêter le serveur de développement (données conservées)
	$(DEV) stop

up: ## Local : image de production (tester le build final)
	docker compose up -d --build

logs: ## Suivre les logs de l'application
	docker compose logs --tail=100 -f app

deploy-remote: ## Envoyer, tester, sauvegarder et déployer sur le Mac mini via SSH
	@bash scripts/deploy-remote.sh
