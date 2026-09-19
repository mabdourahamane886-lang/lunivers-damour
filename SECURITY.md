# Security — L’univers d’amour

## Secrets et clés API

Les clés privées doivent rester dans les **Secrets Cloudflare Workers** et ne doivent jamais être copiées dans HTML, JavaScript côté navigateur, Git, captures d’écran ou messages publics.

Variables secrètes utilisées ou réservées par le projet :
- `SUPABASE_SERVICE_ROLE_KEY`
- `OPENAI_API_KEY` si l’API OpenAI est activée
- `CLOUDFLARE_API_TOKEN` et `CLOUDFLARE_ACCOUNT_ID` lorsqu’un pipeline CI/CD externe les utilise

Le dépôt ne doit contenir aucune valeur réelle de ces secrets.

## Règle de conservation

Un déploiement ne doit pas supprimer les Secrets Cloudflare existants. Les secrets sont gérés séparément du code source. Ne jamais remplacer une clé existante par une valeur vide et ne jamais demander à l’utilisateur de publier une clé privée dans le dépôt.

Les variables existantes doivent être **conservées** lors des modifications du code. Toute nouvelle intégration doit réutiliser les secrets déjà configurés lorsque leur nom et leur fonction correspondent.

## Protection de l’API

Les routes API :
- ne renvoient jamais les secrets ;
- utilisent le rôle service Supabase uniquement côté serveur ;
- utilisent des cookies de session HttpOnly, Secure et SameSite=Strict ;
- désactivent la mise en cache des réponses API ;
- appliquent des en-têtes de sécurité ;
- limitent les requêtes d’IA par adresse IP.
