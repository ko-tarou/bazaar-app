.PHONY: dev front back

# front + back を同時起動
dev:
	make -j2 front back

front:
	cd front && npm run dev

back:
	cd back && go run main.go
