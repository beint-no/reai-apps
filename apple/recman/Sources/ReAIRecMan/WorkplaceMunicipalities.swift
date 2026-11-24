import Foundation

enum WorkplaceMunicipalities {
    private struct Response: Decodable {
        struct Metadata: Decodable { let totaltAntallTreff: Int }
        struct Address: Decodable {
            let adressetekst: String
            let postnummer: String
            let kommunenummer: String
            let kommunenavn: String
        }
        let metadata: Metadata
        let adresser: [Address]
    }

    static func lookup(_ addresses: [RecManCompany.Address]) async -> [RecManCompany.Address: AccountingOption] {
        let config = URLSessionConfiguration.ephemeral
        config.timeoutIntervalForRequest = 4
        config.timeoutIntervalForResource = 5
        let session = URLSession(configuration: config, delegate: RedirectBlocker(), delegateQueue: nil)
        defer { session.finishTasksAndInvalidate() }

        // Limit public address lookups per review and reuse the result for every job at that address.
        let bounded = Array(addresses.prefix(40))
        var results: [RecManCompany.Address: AccountingOption] = [:]
        for offset in stride(from: 0, to: bounded.count, by: 8) {
            let batch = bounded[offset..<min(offset + 8, bounded.count)]
            await withTaskGroup(of: (RecManCompany.Address, AccountingOption?).self) { group in
                for address in batch {
                    group.addTask { (address, await resolve(address, session: session)) }
                }
                for await (address, match) in group { results[address] = match }
            }
        }
        return results
    }

    private static func resolve(_ address: RecManCompany.Address, session: URLSession) async -> AccountingOption? {
        guard let street = normalizedIdentity(address.address1), street.count <= 150,
              let postcode = normalizedIdentity(address.postalCode),
              postcode.range(of: #"^[0-9]{4}$"#, options: .regularExpression) != nil else { return nil }
        let url = URL(string: "https://api.kartverket.no/adresser/v1/sok")!.appending(queryItems: [
            URLQueryItem(name: "adressetekst", value: street),
            URLQueryItem(name: "postnummer", value: postcode),
            URLQueryItem(name: "treffPerSide", value: "20")
        ])
        var request = URLRequest(url: url)
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        request.setValue("en", forHTTPHeaderField: "Accept-Language")
        guard let (data, response) = try? await session.data(for: request),
              let http = response as? HTTPURLResponse, http.statusCode == 200, data.count <= 250_000,
              let result = try? JSONDecoder().decode(Response.self, from: data),
              result.metadata.totaltAntallTreff == result.adresser.count else { return nil }
        let exact = result.adresser.filter {
            $0.postnummer == postcode && $0.adressetekst.caseInsensitiveCompare(street) == .orderedSame
        }
        guard let match = exact.first, Set(exact.map(\.kommunenummer)).count == 1 else { return nil }
        return AccountingOption(id: match.kommunenummer, label: "\(match.kommunenavn) (\(match.kommunenummer))")
    }
}
