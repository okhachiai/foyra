-- Migration séparée : une nouvelle valeur d'enum n'est utilisable qu'après validation de sa transaction.
ALTER TYPE "AccessLevel" ADD VALUE 'MANAGE';
