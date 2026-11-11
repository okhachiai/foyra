.DEFAULT_GOAL := help

DEV = docker compose -f docker-compose.yml -f docker-compose.dev.yml

.PHONY: help dev dev-logs dev-stop up logs deploy-remote audit-up audit audit-down

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

deploy-remote: ## Télécharger l’image publiée, sauvegarder et déployer via SSH
	@bash scripts/deploy-remote.sh

audit-up: ## Audit : instance locale jetable (127.0.0.1:3100) + données fictives
	@bash security/audit.sh up

audit: ## Audit : gitleaks, semgrep, trivy, ZAP baseline, vitest (FULL=1 : ZAP actif)
	@bash security/audit.sh scan $(if $(FULL),--full)

audit-down: ## Audit : supprimer l'instance et ses données
	@bash security/audit.sh down
